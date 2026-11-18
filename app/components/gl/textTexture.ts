/**
 * Draws the text of a DOM element into a 2D canvas, using its computed style
 * (font, weight, size, color, line-height, letter-spacing, text-transform, text-align),
 * so the WebGL texture matches what CSS would display.
 */
export function fontOf(el: HTMLElement) {
    const cs = getComputedStyle(el);
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

const transform = (text: string, mode: string) => {
    if (mode === "uppercase") return text.toUpperCase();
    if (mode === "lowercase") return text.toLowerCase();
    if (mode === "capitalize") return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    return text;
};

export function drawText(
    canvas: HTMLCanvasElement,
    el: HTMLElement,
    width: number, // CSS px, bleed included
    height: number,
    pixelRatio: number,
    bleed: { x: number; y: number },
) {
    const cs = getComputedStyle(el);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.font = fontOf(el);
    ctx.fillStyle = cs.color;
    ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;

    const padL = parseFloat(cs.paddingLeft);
    const padT = parseFloat(cs.paddingTop);
    const maxWidth = el.clientWidth - padL - parseFloat(cs.paddingRight);

    // Word wrap, same width as the DOM box
    const words = transform(el.textContent ?? "", cs.textTransform).trim().split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(test).width > maxWidth) {
            lines.push(line);
            line = word;
        } else line = test;
    }
    if (line) lines.push(line);

    // Same vertical placement as CSS: half-leading around the font's ascent + descent
    const metrics = ctx.measureText("Hg");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    const lineHeight = cs.lineHeight === "normal" ? ascent + descent : parseFloat(cs.lineHeight);
    const align = cs.textAlign;

    lines.forEach((text, i) => {
        const lineWidth = ctx.measureText(text).width;
        const free = maxWidth - lineWidth;
        const dx = align === "center" ? free / 2 : align === "right" || align === "end" ? free : 0;
        const y = bleed.y + padT + i * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent;
        ctx.fillText(text, bleed.x + padL + dx, y);
    });
}
