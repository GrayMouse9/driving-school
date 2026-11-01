export async function trimTransparent(img: HTMLImageElement, alphaMin = 40): Promise<void> {
  try {
    if (!img.complete || !img.naturalWidth) await img.decode();
    const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k);
    const h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let l = w, t = h, r = -1, b = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > alphaMin) {
          if (x < l) l = x;
          if (x > r) r = x;
          if (y < t) t = y;
          if (y > b) b = y;
        }
      }
    }
    if (r < 0) return;
    const out = document.createElement("canvas");
    out.width = r - l + 1;
    out.height = b - t + 1;
    out.getContext("2d")!.drawImage(c, l, t, out.width, out.height, 0, 0, out.width, out.height);
    img.src = out.toDataURL("image/png");
  } catch {
    // не вышло — остаётся исходная картинка
  }
}
