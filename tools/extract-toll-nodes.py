"""Optional build-time dependency: osmium. Usage: python tools/extract-toll-nodes.py portugal.osm.pbf nodes.json"""
import sys,json,osmium
processor=osmium.FileProcessor(sys.argv[1],entities=osmium.osm.NODE).with_filter(osmium.filter.TagFilter(('barrier','toll_booth'),('barrier','toll_gantry'),('highway','toll_gantry')))
nodes=[{'id':n.id,'lat':n.location.lat,'lon':n.location.lon,'tags':dict(n.tags)} for n in processor]
with open(sys.argv[2],'w',encoding='utf-8') as file:json.dump(nodes,file,ensure_ascii=False)
print('Extracted',len(nodes),'toll nodes. Source: OpenStreetMap contributors (ODbL).')
