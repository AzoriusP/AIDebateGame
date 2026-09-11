"""Author masks for generated blink/talking variants; no painting is fabricated."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'work/live2d/male-master/acting-v2/face-rig'
WORK.mkdir(parents=True,exist_ok=True)
CASES={
 'Neutral':('neutral', [[(717,266),(777,266),(799,278),(798,310),(719,314)],[(799,270),(817,272),(819,298),(800,300)]], [(746,333),(797,331),(804,349),(797,386),(748,389)]),
 'Lean':('lean', [[(826,325),(856,331),(906,342),(904,374),(828,375)],[(913,337),(942,339),(943,365),(914,367)]], [(833,402),(882,400),(900,417),(893,442),(837,447)]),
 'Point':('point', [[(587,247),(643,247),(681,257),(681,289),(587,294)],[(682,252),(700,253),(702,280),(681,282)]], [(605,331),(662,326),(674,342),(666,374),(608,382)])
}
layers=[]
for name,(tag,eyes,mouth) in CASES.items():
    for suffix,polygons in [('EyesClosed',eyes),('MouthOpen',[mouth])]:
        mask=Image.new('L',(1536,1536))
        draw=ImageDraw.Draw(mask)
        for polygon in polygons: draw.polygon(polygon,fill=255)
        mask=mask.filter(ImageFilter.GaussianBlur(1.5))
        file=WORK/(name+'_'+suffix+'.mask.png');mask.save(file)
        layers.append({'name':name+'_'+suffix,'image':'design/art-output/live2d-source/male-master/acting-v2/klein-'+tag+'-face-01_00002_.png',
                       'mask':file.relative_to(ROOT).as_posix(),'visible':False})
(WORK/'extraction.json').write_text(json.dumps({'layers':layers},indent=2),encoding='utf-8')
print(WORK/'extraction.json')
