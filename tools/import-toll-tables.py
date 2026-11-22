# Optional build-time dependency: pdfplumber. Usage: python tools/import-toll-tables.py source.pdf rates.json
import pdfplumber,re,json,sys
p=pdfplumber.open(sys.argv[1])
rates={};names={};errors=[]
for page_index in [*range(8),10,11]:
    page=p.pages[page_index];words=page.extract_words(x_tolerance=1,y_tolerance=1)
    headers=sorted([w for w in page.extract_words() if re.fullmatch(r':\d{4}',w['text'])],key=lambda w:w['x0'])
    if page_index>=10:
        colons=sorted([c for c in page.chars if c['text']==':' and c['top']<170 and c['x0']>170],key=lambda c:c['x0'])
        assert len(colons)==11,len(colons)
        headers=[{**c,'text':':'+str(1711+i)[::-1]} for i,c in enumerate(colons)]
    assert headers,(page_index,'no headers')
    ids=[w['text'][1:][::-1] for w in headers]
    centers=[(w['x0']+w['x1'])/2 for w in headers]
    bounds=[centers[0]-(centers[1]-centers[0])/2]+[(a+b)/2 for a,b in zip(centers,centers[1:])]+[centers[-1]+(centers[-1]-centers[-2])/2]
    origins=[w for w in words if re.match(r'^\d{4}[:\-]',w['text']) and w['x0']<centers[0]-10]
    cls=page_index%4 if page_index<8 else (page_index-10)*2
    first_code=origins[0]['text'][:4];seen_first=False
    for w in origins:
        code=w['text'][:4];y=w['top'];row=[c for c in page.chars if abs(c['top']-y)<1.5 and c['x0']>=bounds[0]]
        if page_index>=10 and code==first_code:
            if seen_first:cls+=1
            seen_first=True
        label=page.crop((w['x0'],y-0.5,bounds[0],w['bottom']+0.5)).extract_text() or code
        names[code]=re.sub(r'\s+\d{1,2}$','',label)
        for j,destination in enumerate(ids):
            chars=sorted([c for c in row if bounds[j]<=(c['x0']+c['x1'])/2<bounds[j+1]],key=lambda c:c['x0'])
            text=''.join(c['text'] for c in chars).replace(' ','')
            if not text:continue
            if not re.fullmatch(r'\d+,\d{2}€',text):errors.append((page_index+1,code,destination,text));continue
            if code==destination:continue # diagonal figures are lost-ticket/maximum tariffs, never zero-distance fares
            rate=rates.setdefault(code+'>'+destination,[None]*4)
            rate[cls]=round(float(text[:-1].replace(',','.'))*100)
    print('page',page_index+1,'headers',len(ids),'rows',len(origins),'errors',len(errors))
print('Excluded ambiguous cells',errors[:15])
rates={k:v for k,v in rates.items() if all(c is not None for c in v)}
assert rates['0137>0121']==[390,680,875,970]
assert rates['0121>0119']==[515,900,1160,1285]
with open(sys.argv[2],'w',encoding='utf-8') as f:json.dump({'names':names,'rates':rates},f,ensure_ascii=False)
print('Complete directed fares',len(rates),'stations',len(names))
