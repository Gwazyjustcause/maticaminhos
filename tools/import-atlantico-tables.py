"""Read the official 2026 A8/A15 matrices without treating empty cells as zero.
Optional pdfplumber dependency. Usage: python tools/import-atlantico-tables.py source.pdf output.json
"""
import pdfplumber,re,json,sys
codes=[['0811','0812','0813','0814','0815','0816','0817','0818','0819'],['0830','0831','0832','0833','0834','0835','0836','0837'],['1511','1512','1513','1514','1515','1516','0124','0123']]
rates={}
def groups(values,tolerance):
    out=[]
    for v in sorted(values):
        if not out or v-out[-1][-1]>tolerance:out.append([])
        out[-1].append(v)
    return [sum(g)/len(g) for g in out]
for page_index,page in enumerate(pdfplumber.open(sys.argv[1]).pages):
    assert '2026-01-01' in page.extract_text(),'Unexpected tariff edition'
    ids=codes[page_index];words=page.extract_words()
    tables=page.find_tables();assert len(tables)==4
    for cls,table in enumerate(tables):
        x0,y0,x1,y1=table.bbox
        money=[w for w in words if re.fullmatch(r'\d+,\d{2}',w['text']) and x0<=w['x0']<=x1 and y0<=w['top']<=y1]
        xs=groups([(w['x0']+w['x1'])/2 for w in money],5)
        ys=groups([w['top'] for w in money],1)
        assert len(xs)==len(ys)==len(ids),(page_index,cls,xs,ys)
        for w in money:
            i=min(range(len(ys)),key=lambda i:abs(w['top']-ys[i]))
            j=min(range(len(xs)),key=lambda j:abs((w['x0']+w['x1'])/2-xs[j]))
            if i==j:continue
            key=ids[i]+'>'+ids[j];row=rates.setdefault(key,[None]*4)
            assert row[cls] is None,(page_index,cls,key,'Duplicate cell')
            row[cls]=round(float(w['text'].replace(',','.'))*100)
assert all(all(v is not None for v in row) for row in rates.values())
with open(sys.argv[2],'w',encoding='utf8') as f:json.dump({'rates':rates,'source':{'id':'atlantico-2026','name':'Autoestradas do Atlântico official A8/A15 matrices, 2026','url':'https://www.aeatlantico.pt/wp-content/uploads/2025/12/Taxas-20260101_Site.pdf','effectiveFrom':'2026-01-01'}},f,ensure_ascii=False)
print('Extracted',len(rates),'complete four-class directed fares')
