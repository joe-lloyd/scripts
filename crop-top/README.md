# crop-top

Cuts a fixed number of pixels off the top of every image in a folder. Originals are never changed.

```
npm run crop-top:crop -- /path/to/folder            # 20px, writes /path/to/folder/cropped/
npm run crop-top:crop -- /path/to/folder --px 35    # different amount
npm run crop-top:crop -- /path/to/folder --out /somewhere/else
npm run crop-top:crop                               # no folder: crop-top/in -> crop-top/out
```

Handles jpg, png, webp, tiff, avif and gif (first frame only). EXIF rotation is applied before cutting, so "top" means the top as you see it. An image shorter than the cut fails on its own and the rest of the batch continues.
