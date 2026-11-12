// High-Performance Squarified Treemap Algorithm (Karpathy / Bruls-Huizing-van Wijk style)

class SquarifiedTreemap {
  static squarify(items, x, y, w, h) {
    if (!items || items.length === 0 || w <= 0 || h <= 0) return [];
    if (items.length === 1) {
      return [{ ...items[0], rx: x, ry: y, rw: w, rh: h }];
    }

    const total = items.reduce((s, d) => s + d.weight, 0);
    if (total === 0) return [];

    const results = [];
    let remaining = [...items];
    let cx = x, cy = y, cw = w, ch = h;

    while (remaining.length > 0) {
      const remTotal = remaining.reduce((s, d) => s + d.weight, 0);
      const vertical = cw >= ch;
      const side = vertical ? ch : cw;
      let row = [remaining[0]];
      let rowSum = remaining[0].weight;

      for (let i = 1; i < remaining.length; i++) {
        const candidate = [...row, remaining[i]];
        const candidateSum = rowSum + remaining[i].weight;
        if (this.worstAspect(candidate, candidateSum, side, remTotal, vertical ? cw : ch) <
            this.worstAspect(row, rowSum, side, remTotal, vertical ? cw : ch)) {
          row = candidate;
          rowSum = candidateSum;
        } else {
          break;
        }
      }

      const rowFraction = rowSum / remTotal;
      const rowThickness = vertical ? cw * rowFraction : ch * rowFraction;
      let offset = 0;

      for (const item of row) {
        const itemFraction = item.weight / rowSum;
        const itemLength = side * itemFraction;
        if (vertical) {
          results.push({
            ...item,
            rx: cx,
            ry: cy + offset,
            rw: rowThickness,
            rh: itemLength
          });
        } else {
          results.push({
            ...item,
            rx: cx + offset,
            ry: cy,
            rw: itemLength,
            rh: rowThickness
          });
        }
        offset += itemLength;
      }

      if (vertical) {
        cx += rowThickness;
        cw = Math.max(0, cw - rowThickness);
      } else {
        cy += rowThickness;
        ch = Math.max(0, ch - rowThickness);
      }

      remaining = remaining.slice(row.length);
    }

    return results;
  }

  static worstAspect(row, rowSum, side, remTotal, otherSide) {
    const rowThickness = otherSide * (rowSum / remTotal);
    if (rowThickness <= 0 || rowSum <= 0) return Infinity;

    let worst = 0;
    for (const item of row) {
      const itemLen = side * (item.weight / rowSum);
      if (itemLen <= 0) return Infinity;
      const aspect = Math.max(rowThickness / itemLen, itemLen / rowThickness);
      if (aspect > worst) worst = aspect;
    }
    return worst;
  }
}

window.SquarifiedTreemap = SquarifiedTreemap;
