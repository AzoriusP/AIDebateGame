"""Control masks traced from candidate-03's inspected face; white = selected.

Only masks are authored here. Artwork is extracted/repaired in ComfyUI.
L/R labels use the character's own side (opposite to the image side).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

root=Path(__file__).resolve().parents[2]
out=root/'work/live2d/male-master/masks'
out.mkdir(parents=True,exist_ok=True)
polygons={
    'eye-r-open':[(434,291),(465,291),(485,294),(499,300),(504,307),(496,315),(484,322),(454,323),(440,318),(432,305)],
    'eye-l-open':[(535,297),(552,291),(576,290),(596,289),(598,302),(590,314),(581,323),(553,326),(534,323),(529,312)],
    'brow-r':[(433,278),(439,269),(449,270),(475,280),(496,289),(500,297),(484,294),(453,285),(436,284)],
    'brow-l':[(530,286),(553,277),(579,270),(598,273),(598,283),(572,284),(548,293),(527,298)],
    'mouth-closed':[(491,378),(505,378),(515,380),(529,378),(544,383),(547,391),(531,392),(519,387),(505,390),(491,388)],
}
combined=Image.new('L',(1024,1536),0)
for name,pts in polygons.items():
    large=Image.new('L',(4096,6144),0)
    ImageDraw.Draw(large).polygon([(x*4,y*4) for x,y in pts],fill=255)
    mask=large.resize((1024,1536),Image.Resampling.LANCZOS)
    mask.save(out/(name+'-v1.png'))
    combined=ImageChops.lighter(combined,mask)
combined.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(2)).save(out/'face-features-repaint-v1.png')
expression=Image.new('L',(1024,1536),0)
for name in ['eye-r-open','eye-l-open']:
    expression=ImageChops.lighter(expression,Image.open(out/(name+'-v1.png')))
expression.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1)).save(out/'eyes-closed-repaint-v1.png')
ImageDraw.Draw(expression).ellipse((484,363,550,406),fill=255)
expression.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(2)).save(out/'expression-repaint-v1.png')
mouth=Image.new('L',(1024,1536),0)
ImageDraw.Draw(mouth).ellipse((478,362,554,411),fill=255)
mouth.filter(ImageFilter.GaussianBlur(2)).save(out/'mouth-open-repaint-v1.png')
for name,pts in {
    'mouth-closed-wide':[(480,371),(552,371),(552,402),(480,402)],
    'mouth-open':[(493,363),(531,362),(544,379),(543,392),(531,401),(493,399),(484,392),(484,381)],
}.items():
    m=Image.new('L',(4096,6144),0)
    ImageDraw.Draw(m).polygon([(x*4,y*4) for x,y in pts],fill=255)
    m.resize((1024,1536),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.6)).save(out/(name+'-v1.png'))
print(out)
