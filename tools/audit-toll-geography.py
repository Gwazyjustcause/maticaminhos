"""Build-time audit: retain the tagged ways containing every mapped toll node.
Usage: python tools/audit-toll-geography.py portugal.osm.pbf nodes.json ways.json
Requires optional osmium; no runtime dependencies for drivers.
"""
import json,sys,osmium
nodes=json.load(open(sys.argv[2],encoding='utf8'))
ids={n['id'] for n in nodes};ways=[]
for w in osmium.FileProcessor(sys.argv[1],entities=osmium.osm.WAY):
    hits=[n.ref for n in w.nodes if n.ref in ids]
    if hits:ways.append({'id':w.id,'tags':dict(w.tags),'tollNodes':hits})
with open(sys.argv[3],'w',encoding='utf8') as f:json.dump(ways,f,ensure_ascii=False)
print('Audited',len(ways),'ways containing toll nodes')
