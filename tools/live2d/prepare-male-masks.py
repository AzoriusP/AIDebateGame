"""Author repaint guides for the visually inspected candidate-03 canvas.

These are control masks, not substitute character artwork. They are kept apart
from the immutable candidate and from the eventual individual raster layers.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

project=Path(__file__).resolve().parents[2]
out=project/'work/live2d/male-master/masks'
out.mkdir(parents=True,exist_ok=True)
mask=Image.new('L',(1024,1536),0)
draw=ImageDraw.Draw(mask)
draw.polygon([(188,1166),(276,1170),(319,1248),(322,1369),(190,1386),(163,1240)],fill=255)
draw.polygon([(744,1168),(838,1183),(853,1270),(840,1380),(691,1380),(674,1246)],fill=255)
mask.filter(ImageFilter.GaussianBlur(3)).convert('RGB').save(out/'hands-v1.png')
print(out/'hands-v1.png')
