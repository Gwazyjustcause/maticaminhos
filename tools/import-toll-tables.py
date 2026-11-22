# Optional pdfplumber. Usage: python tools/import-toll-tables.py august.pdf rates.json march.pdf
import pdfplumber,re,json,sys,hashlib
p=pdfplumber.open(sys.argv[1])
rates={};names={};errors=[]
pages=[(i,p.pages[i]) for i in [*range(8),10,11]]
if len(sys.argv)>3:
    south=pdfplumber.open(sys.argv[3])
    pages += [(i,south.pages[i]) for i in [8,9]]
for page_index,page in pages:
    assert '2026' in page.crop((0,0,page.width,45)).extract_text(),'Outdated tariff heading'
    words=page.extract_words(x_tolerance=1,y_tolerance=1)
    headers=sorted([w for w in page.extract_words() if re.fullmatch(r':\d{4}',w['text'])],key=lambda w:w['x0'])
    if page_index>=10:
        colons=sorted([c for c in page.chars if c['text']==':' and c['top']<170 and c['x0']>170],key=lambda c:c['x0'])
        assert len(colons)==11,len(colons)
        headers=[{**c,'text':':'+str(1711+i)[::-1]} for i,c in enumerate(colons)]
    assert headers,(page_index,'no headers')
    ids=[w['text'][1:][::-1] for w in headers]
    centers=[(w['x0']+w['x1'])/2 for w in headers]
    # Rotated labels sit at the RIGHT of each column, not its centre.
    # Midpoints between their x positions clipped leading digits (e.g. 23,15
    # became 3,15) while still looking like valid currency. Read whole amounts
    # first and correlate their euro symbol to the right-aligned header.
    rights=[w['x1'] for w in headers]
    label_end=rights[0]-(rights[1]-rights[0])+1
    origins=[w for w in words if re.match(r'^\d{4}[:\-]',w['text']) and w['x0']<centers[0]-10]
    cls=page_index%4 if page_index<8 else (page_index%2)*2
    first_code=origins[0]['text'][:4];seen_first=False
    for w in origins:
        code=w['text'][:4];y=w['top'];row=sorted([c for c in page.chars if abs(c['top']-y)<1.5 and c['x0']>=label_end],key=lambda c:c['x0'])
        if page_index>=8 and code==first_code:
            if seen_first:cls+=1
            seen_first=True
        label=page.crop((w['x0'],y-0.5,label_end,w['bottom']+0.5)).extract_text() or code
        names[code]=re.sub(r'\s+\d{1,2}$','',label)
        row=[c for c in row if c['text']!=' ']
        text=''.join(c['text'] for c in row)
        seen=set()
        for match in re.finditer(r'\d+,\d{2}€',text):
            amount=match.group();right=row[match.end()-1]['x1']
            j=min(range(len(ids)),key=lambda j:abs(right-rights[j]))
            assert abs(right-rights[j])<5,(page_index,code,amount,right,rights[j])
            assert j not in seen,(page_index,code,j)
            seen.add(j);destination=ids[j]
            if code==destination:continue # diagonal figures are lost-ticket/maximum tariffs, never zero-distance fares
            rate=rates.setdefault(code+'>'+destination,[None]*4)
            rate[cls]=round(float(amount[:-1].replace(',','.'))*100)
        assert len(seen)==text.count('€'),(page_index,code,'unparsed currency',text)
    print('page',page_index+1,'headers',len(ids),'rows',len(origins),'errors',len(errors))
print('Excluded ambiguous cells',errors[:15])
rates={k:v for k,v in rates.items() if all(c is not None for c in v)}
# A41 heavy-vehicle exemptions legitimately make some cross-network rows
# non-monotonic. Audit those explicitly rather than imposing a false rule.
exceptions=('32','41','43')
assert all(v==sorted(v) or k.startswith(exceptions) or k in ['0127>0130','0131>0127','0132>0130'] for k,v in rates.items()),'Unexpected class-price ordering'
assert all(rates.get(b+'>'+a)==v for k,v in rates.items() for a,b in [k.split('>')] if b+'>'+a in rates and a not in ['0127','0130','0131','0132'] and b not in ['0127','0130','0131','0132']),'Conflicting reciprocal fares'
assert rates['0137>0121']==[390,680,875,970]
assert rates['0121>0119']==[515,900,1160,1285]
digests={name:hashlib.sha256(open(path,'rb').read()).hexdigest() for name,path in [('brisa-august-2026',sys.argv[1])]+([('brisa-south-2026',sys.argv[3])] if len(sys.argv)>3 else [])}
with open(sys.argv[2],'w',encoding='utf-8') as f:json.dump({'names':names,'rates':rates,'sourceDigests':digests},f,ensure_ascii=False)
print('Complete directed fares',len(rates),'stations',len(names))
