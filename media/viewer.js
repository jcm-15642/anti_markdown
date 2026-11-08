(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Create an HTML element with class, textContent, and attributes using safe DOM APIs.
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @param {Record<string, string | number>} [attrs]
   * @returns {HTMLElement}
   */
  function el(tag, className, text, attrs) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    if (attrs) {
      const keys = Object.keys(attrs);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (attrs[k] !== undefined && attrs[k] !== null) {
          node.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return node;
  }

  /**
   * Create an SVG element safely via createElementNS.
   * @param {string} tag
   * @param {Record<string, string | number>} [attrs]
   * @param {string} [text]
   * @returns {SVGElement}
   */
  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      const keys = Object.keys(attrs);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (attrs[k] !== undefined && attrs[k] !== null) {
          node.setAttribute(k, String(attrs[k]));
        }
      }
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  /**
   * Generate a URL-friendly heading slug.
   * @param {string} text
   * @param {number} index
   * @returns {string}
   */
  function slugifyHeading(text, index) {
    const cleaned = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[`*_~[\]()<>!@#$%^&+=|\\:;"'?,./]/g, '')
      .replace(/\s+/g, '-');
    return cleaned ? `heading-${cleaned}-${index}` : `heading-${index}`;
  }

  /**
   * Parse Markdown text into a structured AST where every block records its exact
   * 0-based [startLine, endLine] and rawMarkdown slice for in-place live editing and selection mapping.
   * @param {string} rawMarkdown
   * @returns {{ frontmatter: Array<{key: string, value: string}>, blocks: Array<any>, headings: Array<any>, lines: string[] }}
   */
  function parseMarkdownToAst(rawMarkdown) {
    const normalized = String(rawMarkdown || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const frontmatter = [];
    const blocks = [];
    const headings = [];

    let i = 0;

    // 1. Optional YAML Frontmatter at start of file
    if (lines[0] && lines[0].trim() === '---') {
      let endFm = -1;
      for (let j = 1; j < Math.min(lines.length, 60); j++) {
        if (lines[j].trim() === '---' || lines[j].trim() === '...') {
          endFm = j;
          break;
        }
      }
      if (endFm > 0) {
        for (let j = 1; j < endFm; j++) {
          const fmMatch = lines[j].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
          if (fmMatch) {
            frontmatter.push({
              key: fmMatch[1].trim(),
              value: fmMatch[2].trim().replace(/^['"]|['"]$/g, '')
            });
          }
        }
        i = endFm + 1;
      }
    }

    function pushBlock(blockObj, startLine, endLine) {
      const safeStart = Math.max(0, startLine);
      const safeEnd = Math.max(safeStart, Math.min(lines.length - 1, endLine));
      blockObj.startLine = safeStart;
      blockObj.endLine = safeEnd;
      blockObj.rawMarkdown = lines.slice(safeStart, safeEnd + 1).join('\n');
      blocks.push(blockObj);
    }

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // 2. Fenced Code Block / Carousel / Mermaid (3+ backticks or tildes)
      const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`~]*)(.*)$/);
      if (fenceMatch) {
        const fenceChars = fenceMatch[2];
        const fenceChar = fenceChars[0];
        const fenceLen = fenceChars.length;
        const lang = (fenceMatch[3] || '').trim().toLowerCase();
        const meta = (fenceMatch[4] || '').trim();
        const contentLines = [];
        const startLine = i;
        i++;

        while (i < lines.length) {
          const closeMatch = lines[i].match(new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`));
          if (closeMatch) {
            i++;
            break;
          }
          contentLines.push(lines[i]);
          i++;
        }

        const endLine = i - 1;
        const codeContent = contentLines.join('\n');
        if (lang === 'carousel') {
          const slides = codeContent
            .split(/<!--\s*slide\s*-->/i)
            .map((s) => s.trim())
            .filter(Boolean);
          pushBlock({ type: 'carousel', slides }, startLine, endLine);
        } else if (lang === 'mermaid') {
          pushBlock({ type: 'mermaid', code: codeContent }, startLine, endLine);
        } else if (lang === 'math' || lang === 'latex' || lang === 'katex') {
          pushBlock({ type: 'mathBlock', expression: codeContent }, startLine, endLine);
        } else {
          pushBlock(
            {
              type: 'code',
              lang: lang || 'text',
              meta,
              code: codeContent,
              codeStartLine: startLine + 1
            },
            startLine,
            endLine
          );
        }
        continue;
      }

      // 3. Display Math Block $$ ... $$ or \[ ... \]
      if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
        const isDollar = trimmed.startsWith('$$');
        const closeToken = isDollar ? '$$' : '\\]';
        const firstLineRest = trimmed.slice(2).trim();
        const startLine = i;

        if (firstLineRest.endsWith(closeToken) && firstLineRest.length > closeToken.length) {
          pushBlock(
            {
              type: 'mathBlock',
              expression: firstLineRest.slice(0, -closeToken.length).trim()
            },
            startLine,
            i
          );
          i++;
          continue;
        }

        const exprLines = [];
        if (firstLineRest && firstLineRest !== closeToken) {
          exprLines.push(firstLineRest);
        }
        i++;
        while (i < lines.length) {
          const curTrim = lines[i].trim();
          if (curTrim.endsWith(closeToken)) {
            const beforeClose = curTrim.slice(0, -closeToken.length).trim();
            if (beforeClose) {
              exprLines.push(beforeClose);
            }
            i++;
            break;
          }
          exprLines.push(lines[i]);
          i++;
        }
        pushBlock(
          {
            type: 'mathBlock',
            expression: exprLines.join('\n').trim()
          },
          startLine,
          i - 1
        );
        continue;
      }

      // 4. ATX Heading (# ... ######)
      const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const rawText = headingMatch[2].trim();
        const id = slugifyHeading(rawText, headings.length);
        const headingObj = {
          type: 'heading',
          level,
          text: rawText,
          id
        };
        pushBlock(headingObj, i, i);
        headings.push(headingObj);
        i++;
        continue;
      }

      // 5. Horizontal Rule
      if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
        pushBlock({ type: 'hr' }, i, i);
        i++;
        continue;
      }

      // 6. Blockquote or GitHub-style Alert (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
      if (/^\s*>/.test(line)) {
        const quoteLines = [];
        const startLine = i;
        while (
          i < lines.length &&
          (/^\s*>/.test(lines[i]) ||
            (lines[i].trim() !== '' &&
              quoteLines.length > 0 &&
              !/^\s*(?:#|`{3,}|[-*+]\s|\d+\.\s|\|)/.test(lines[i])))
        ) {
          if (/^\s*>/.test(lines[i])) {
            quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          } else {
            quoteLines.push(lines[i]);
          }
          i++;
        }

        const endLine = i - 1;
        const firstQuoteLine = (quoteLines[0] || '').trim();
        const alertMatch = firstQuoteLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
        if (alertMatch) {
          const alertType = alertMatch[1].toUpperCase();
          const inlineFirstLine = alertMatch[2].trim();
          const bodyLines = [];
          if (inlineFirstLine) {
            bodyLines.push(inlineFirstLine);
          }
          for (let q = 1; q < quoteLines.length; q++) {
            bodyLines.push(quoteLines[q]);
          }
          pushBlock(
            {
              type: 'alert',
              alertType,
              title: alertType,
              body: bodyLines.join('\n').trim()
            },
            startLine,
            endLine
          );
        } else {
          pushBlock(
            {
              type: 'blockquote',
              body: quoteLines.join('\n').trim()
            },
            startLine,
            endLine
          );
        }
        continue;
      }

      // 7. GFM Table
      if (
        line.includes('|') &&
        i + 1 < lines.length &&
        /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])
      ) {
        const parseTableRow = (rowStr) => {
          let s = rowStr.trim();
          if (s.startsWith('|')) s = s.slice(1);
          if (s.endsWith('|')) s = s.slice(0, -1);
          const cells = [];
          let current = '';
          let inCode = false;
          for (let c = 0; c < s.length; c++) {
            const ch = s[c];
            if (ch === '`') {
              inCode = !inCode;
              current += ch;
            } else if (ch === '\\' && c + 1 < s.length && s[c + 1] === '|') {
              current += '|';
              c++;
            } else if (ch === '|' && !inCode) {
              cells.push(current.trim());
              current = '';
            } else {
              current += ch;
            }
          }
          cells.push(current.trim());
          return cells;
        };

        const headers = parseTableRow(lines[i]);
        const alignCells = parseTableRow(lines[i + 1]);
        const alignments = alignCells.map((a) => {
          const t = a.trim();
          if (t.startsWith(':') && t.endsWith(':')) return 'center';
          if (t.endsWith(':')) return 'right';
          return 'left';
        });

        const startLine = i;
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
          rows.push(parseTableRow(lines[i]));
          i++;
        }

        pushBlock(
          {
            type: 'table',
            headers,
            alignments,
            rows
          },
          startLine,
          i - 1
        );
        continue;
      }

      // 8. Ordered or Unordered List
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        const ordered = /^\d+\.$/.test(listMatch[2]);
        const items = [];
        const startLine = i;

        while (i < lines.length) {
          const itemLine = lines[i];
          if (!itemLine.trim()) {
            if (i + 1 < lines.length && /^(\s*)([-*+]|\d+\.)\s+/.test(lines[i + 1])) {
              i++;
              continue;
            }
            break;
          }
          const m = itemLine.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (m) {
            const indent = m[1].length;
            let itemText = m[3];
            let isTask = false;
            let checked = false;
            const taskMatch = itemText.match(/^\[([ xX])\]\s+(.*)$/);
            if (taskMatch) {
              isTask = true;
              checked = taskMatch[1].toLowerCase() === 'x';
              itemText = taskMatch[2];
            }
            items.push({
              indent,
              orderedItem: /^\d+\.$/.test(m[2]),
              isTask,
              checked,
              text: itemText,
              lineIndex: i
            });
            i++;
          } else if (/^\s{2,}\S/.test(itemLine) && items.length > 0) {
            items[items.length - 1].text += '\n' + itemLine.trim();
            i++;
          } else {
            break;
          }
        }

        pushBlock(
          {
            type: 'list',
            ordered,
            items
          },
          startLine,
          i - 1
        );
        continue;
      }

      // 9. Standard Paragraph
      const paraLines = [line];
      const startLine = i;
      i++;
      while (i < lines.length) {
        const nextLine = lines[i];
        const nextTrim = nextLine.trim();
        if (
          !nextTrim ||
          /^(\s*)(`{3,}|~{3,})/.test(nextLine) ||
          /^\s*#{1,6}\s+/.test(nextLine) ||
          /^\s*(?:[-*_]\s*){3,}$/.test(nextLine) ||
          /^\s*>/.test(nextLine) ||
          /^(\s*)([-*+]|\d+\.)\s+/.test(nextLine) ||
          nextTrim.startsWith('$$') ||
          nextTrim.startsWith('\\[') ||
          (nextLine.includes('|') &&
            i + 1 < lines.length &&
            /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1]))
        ) {
          break;
        }
        paraLines.push(nextLine);
        i++;
      }

      pushBlock(
        {
          type: 'paragraph',
          text: paraLines.join('\n')
        },
        startLine,
        i - 1
      );
    }

    return { frontmatter, blocks, headings, lines };
  }

  /**
   * Dictionary of LaTeX commands to Unicode mathematical symbols.
   */
  const LATEX_SYMBOLS = {
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    epsilon: 'ϵ',
    varepsilon: 'ε',
    zeta: 'ζ',
    eta: 'η',
    theta: 'θ',
    vartheta: 'ϑ',
    iota: 'ι',
    kappa: 'κ',
    lambda: 'λ',
    mu: 'μ',
    nu: 'ν',
    xi: 'ξ',
    pi: 'π',
    rho: 'ρ',
    sigma: 'σ',
    tau: 'τ',
    upsilon: 'υ',
    phi: 'ϕ',
    varphi: 'φ',
    chi: 'χ',
    psi: 'ψ',
    omega: 'ω',
    Gamma: 'Γ',
    Delta: 'Δ',
    Theta: 'Θ',
    Lambda: 'Λ',
    Xi: 'Ξ',
    Pi: 'Π',
    Sigma: 'Σ',
    Upsilon: 'Υ',
    Phi: 'Φ',
    Psi: 'Ψ',
    Omega: 'Ω',
    sum: '∑',
    prod: '∏',
    coprod: '∐',
    int: '∫',
    iint: '∬',
    iiint: '∭',
    oint: '∮',
    infty: '∞',
    approx: '≈',
    cong: '≅',
    equiv: '≡',
    sim: '∼',
    simeq: '≃',
    propto: '∝',
    neq: '≠',
    ne: '≠',
    leq: '≤',
    le: '≤',
    geq: '≥',
    ge: '≥',
    ll: '≪',
    gg: '≫',
    prec: '≺',
    succ: '≻',
    times: '×',
    div: '÷',
    cdot: '·',
    ast: '∗',
    star: '⋆',
    circ: '∘',
    bullet: '∙',
    pm: '±',
    mp: '∓',
    oplus: '⊕',
    ominus: '⊖',
    otimes: '⊗',
    oslash: '⊘',
    to: '→',
    rightarrow: '→',
    leftarrow: '←',
    leftrightarrow: '↔',
    longrightarrow: '⟶',
    longleftarrow: '⟵',
    Rightarrow: '⇒',
    Leftarrow: '⇐',
    Leftrightarrow: '⇔',
    Longrightarrow: '⟹',
    iff: '⇔',
    implies: '⟹',
    mapsto: '↦',
    uparrow: '↑',
    downarrow: '↓',
    in: '∈',
    notin: '∉',
    ni: '∋',
    subset: '⊂',
    supset: '⊃',
    subseteq: '⊆',
    supseteq: '⊇',
    cup: '∪',
    cap: '∩',
    setminus: '∖',
    emptyset: '∅',
    varnothing: '∅',
    forall: '∀',
    exists: '∃',
    nexists: '∄',
    neg: '¬',
    lnot: '¬',
    land: '∧',
    lor: '∨',
    partial: '∂',
    nabla: '∇',
    ell: 'ℓ',
    hbar: 'ℏ',
    Re: 'ℜ',
    Im: 'ℑ',
    aleph: 'ℵ',
    wp: '℘',
    angle: '∠',
    triangle: '△',
    perp: '⊥',
    parallel: '∥',
    mid: '∣',
    dots: '…',
    ldots: '…',
    cdots: '⋯',
    vdots: '⋮',
    ddots: '⋱',
    prime: '′',
    checkmark: '✓',
    quad: '  ',
    qquad: '    ',
    ',': ' ',
    ';': ' ',
    ':': ' ',
    '!': '',
    '{': '{',
    '}': '}',
    '%': '%',
    '&': '&',
    '_': '_',
    '#': '#'
  };

  const CALLIGRAPHIC_MAP = {
    A: '𝒜', B: 'ℬ', C: '𝒞', D: '𝒟', E: 'ℰ', F: 'ℱ', G: '𝒢', H: 'ℋ', I: 'ℐ',
    J: '𝒥', K: '𝒦', L: 'ℒ', M: 'ℳ', N: '𝒩', O: '𝒪', P: '𝒫', Q: '𝒬', R: 'ℛ',
    S: '𝒮', T: '𝒯', U: '𝒰', V: '𝒱', W: '𝒲', X: '𝒳', Y: '𝒴', Z: '𝒵'
  };

  const BLACKBOARD_MAP = {
    A: '𝔸', B: '𝔹', C: 'ℂ', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', H: 'ℍ', I: '𝕀',
    J: '𝕁', K: '𝕂', L: '𝕃', M: '𝕄', N: 'ℕ', O: '𝕆', P: 'ℙ', Q: 'ℚ', R: 'ℝ',
    S: '𝕊', T: '𝕋', U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏', Y: '𝕐', Z: 'ℤ'
  };

  /**
   * Read a balanced `{...}` group or a single LaTeX token starting at index `pos`.
   * Properly handles arbitrarily nested curly braces!
   * @param {string} src
   * @param {number} pos
   * @returns {{ content: string, nextPos: number }}
   */
  function readLatexArgument(src, pos) {
    let i = pos;
    while (i < src.length && /\s/.test(src[i])) {
      i++;
    }
    if (i >= src.length) {
      return { content: '', nextPos: i };
    }

    if (src[i] === '{') {
      let depth = 1;
      const start = i + 1;
      i++;
      while (i < src.length && depth > 0) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      }
      const end = depth === 0 ? i - 1 : i;
      return { content: src.slice(start, end), nextPos: i };
    }

    if (src[i] === '\\') {
      let end = i + 1;
      if (end < src.length && /[A-Za-z]/.test(src[end])) {
        while (end < src.length && /[A-Za-z]/.test(src[end])) {
          end++;
        }
      } else if (end < src.length) {
        end++;
      }
      return { content: src.slice(i, end), nextPos: end };
    }

    return { content: src[i], nextPos: i + 1 };
  }

  /**
   * Read an optional `[...]` argument starting at index `pos`.
   * @param {string} src
   * @param {number} pos
   * @returns {{ content: string | null, nextPos: number }}
   */
  function readOptionalBracketArg(src, pos) {
    let i = pos;
    while (i < src.length && /\s/.test(src[i])) {
      i++;
    }
    if (i < src.length && src[i] === '[') {
      let depth = 1;
      const start = i + 1;
      i++;
      while (i < src.length && depth > 0) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') depth--;
        i++;
      }
      const end = depth === 0 ? i - 1 : i;
      return { content: src.slice(start, end), nextPos: i };
    }
    return { content: null, nextPos: pos };
  }

  /**
   * Recursively parse a LaTeX math string into DOM elements inside `parent`.
   * Supports arbitrarily nested fractions, subscripts, superscripts, roots, font styles, and matrices.
   * @param {HTMLElement} parent
   * @param {string} expr
   */
  function appendLatexNodes(parent, expr) {
    const src = String(expr || '');
    let i = 0;

    while (i < src.length) {
      const ch = src[i];

      // Skip excess whitespace but preserve spacing around operators
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      // Curly-brace group { ... }
      if (ch === '{') {
        const group = readLatexArgument(src, i);
        const span = el('span');
        appendLatexNodes(span, group.content);
        parent.appendChild(span);
        i = group.nextPos;
        continue;
      }

      // Superscript ^ or Subscript _ (supports combined x_a^b or x^b_a)
      if (ch === '^' || ch === '_') {
        let supContent = null;
        let subContent = null;

        while (i < src.length && (src[i] === '^' || src[i] === '_')) {
          const isSup = src[i] === '^';
          const arg = readLatexArgument(src, i + 1);
          if (isSup) supContent = arg.content;
          else subContent = arg.content;
          i = arg.nextPos;
          while (i < src.length && /\s/.test(src[i])) i++;
        }

        if (supContent !== null && subContent !== null) {
          const scriptWrap = el('span', 'agy-math-script');
          const supEl = el('span');
          appendLatexNodes(supEl, supContent);
          const subEl = el('span');
          appendLatexNodes(subEl, subContent);
          scriptWrap.appendChild(supEl);
          scriptWrap.appendChild(subEl);
          parent.appendChild(scriptWrap);
        } else if (supContent !== null) {
          const supEl = el('sup', 'agy-math-sup');
          appendLatexNodes(supEl, supContent);
          parent.appendChild(supEl);
        } else if (subContent !== null) {
          const subEl = el('sub', 'agy-math-sub');
          appendLatexNodes(subEl, subContent);
          parent.appendChild(subEl);
        }
        continue;
      }

      // LaTeX Command \cmd
      if (ch === '\\') {
        if (i + 1 < src.length && src[i + 1] === '\\') {
          parent.appendChild(el('br'));
          i += 2;
          continue;
        }

        let cmdEnd = i + 1;
        if (cmdEnd < src.length && /[A-Za-z]/.test(src[cmdEnd])) {
          while (cmdEnd < src.length && /[A-Za-z]/.test(src[cmdEnd])) {
            cmdEnd++;
          }
        } else if (cmdEnd < src.length) {
          cmdEnd++;
        }

        const cmd = src.slice(i + 1, cmdEnd);
        i = cmdEnd;

        // 1. Fractions: \frac{num}{den}, \dfrac{num}{den}, \tfrac{num}{den}, \cfrac{num}{den}
        if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac' || cmd === 'cfrac') {
          const numArg = readLatexArgument(src, i);
          const denArg = readLatexArgument(src, numArg.nextPos);
          i = denArg.nextPos;

          const frac = el('span', 'agy-math-frac');
          const numEl = el('span', 'agy-math-frac-num');
          const denEl = el('span', 'agy-math-frac-den');
          appendLatexNodes(numEl, numArg.content);
          appendLatexNodes(denEl, denArg.content);
          frac.appendChild(numEl);
          frac.appendChild(denEl);
          parent.appendChild(frac);
          continue;
        }

        // 2. Square / N-th Root: \sqrt[n]{x} or \sqrt{x}
        if (cmd === 'sqrt') {
          const opt = readOptionalBracketArg(src, i);
          const bodyArg = readLatexArgument(src, opt.nextPos);
          i = bodyArg.nextPos;

          const sqrtWrap = el('span', 'agy-math-sqrt');
          if (opt.content) {
            const rootIdx = el('sup', 'agy-math-sup');
            appendLatexNodes(rootIdx, opt.content);
            sqrtWrap.appendChild(rootIdx);
          }
          sqrtWrap.appendChild(el('span', 'agy-math-sqrt-sign', '√'));
          const bodyEl = el('span', 'agy-math-sqrt-body');
          appendLatexNodes(bodyEl, bodyArg.content);
          sqrtWrap.appendChild(bodyEl);
          parent.appendChild(sqrtWrap);
          continue;
        }

        // 3. Calligraphic \mathcal{...}
        if (cmd === 'mathcal') {
          const arg = readLatexArgument(src, i);
          i = arg.nextPos;
          const raw = arg.content.trim();
          const mapped = raw
            .split('')
            .map((c) => CALLIGRAPHIC_MAP[c] || c)
            .join('');
          parent.appendChild(el('span', 'agy-math-cal', mapped));
          continue;
        }

        // 4. Blackboard Bold \mathbb{...}
        if (cmd === 'mathbb') {
          const arg = readLatexArgument(src, i);
          i = arg.nextPos;
          const raw = arg.content.trim();
          const mapped = raw
            .split('')
            .map((c) => BLACKBOARD_MAP[c] || c)
            .join('');
          parent.appendChild(el('span', 'agy-math-bb', mapped));
          continue;
        }

        // 5. Text / Font styles: \text{...}, \mathrm{...}, \operatorname{...}, \mathbf{...}, \mathit{...}
        if (
          cmd === 'text' ||
          cmd === 'textrm' ||
          cmd === 'mathrm' ||
          cmd === 'operatorname' ||
          cmd === 'mathbf' ||
          cmd === 'boldsymbol' ||
          cmd === 'bm' ||
          cmd === 'mathit' ||
          cmd === 'textit' ||
          cmd === 'mathtt'
        ) {
          const arg = readLatexArgument(src, i);
          i = arg.nextPos;
          const span = el('span', cmd === 'text' || cmd === 'textrm' ? 'agy-math-text' : '');
          if (cmd === 'mathbf' || cmd === 'boldsymbol' || cmd === 'bm') {
            span.style.fontWeight = '700';
          } else if (cmd === 'mathit' || cmd === 'textit') {
            span.style.fontStyle = 'italic';
          } else if (cmd === 'mathtt') {
            span.style.fontFamily = 'var(--agy-font-mono)';
          }
          appendLatexNodes(span, arg.content);
          parent.appendChild(span);
          continue;
        }

        // 6. Overline / Underline / Hat / Bar / Vec / Tilde
        if (
          cmd === 'overline' ||
          cmd === 'underline' ||
          cmd === 'hat' ||
          cmd === 'widehat' ||
          cmd === 'bar' ||
          cmd === 'vec' ||
          cmd === 'tilde' ||
          cmd === 'widetilde'
        ) {
          const arg = readLatexArgument(src, i);
          i = arg.nextPos;
          if (cmd === 'overline' || cmd === 'bar') {
            const span = el('span', 'agy-math-overline');
            appendLatexNodes(span, arg.content);
            parent.appendChild(span);
          } else if (cmd === 'underline') {
            const span = el('span', 'agy-math-underline');
            appendLatexNodes(span, arg.content);
            parent.appendChild(span);
          } else {
            constcombMap = {
              hat: '\u0302',
              widehat: '\u0302',
              vec: '\u20d7',
              tilde: '\u0303',
              widetilde: '\u0303'
            };
            const span = el('span');
            appendLatexNodes(span, arg.content);
            span.appendChild(document.createTextNode(constcombMap[cmd] || ''));
            parent.appendChild(span);
          }
          continue;
        }

        // 7. Sizing modifiers \left, \right, \big, \Big, \bigl, \bigr
        if (cmd === 'left' || cmd === 'right' || cmd === 'big' || cmd === 'Big' || cmd === 'bigl' || cmd === 'bigr') {
          while (i < src.length && /\s/.test(src[i])) i++;
          if (i < src.length) {
            if (src[i] === '.') {
              i++;
            } else if (src.slice(i, i + 2) === '\\{' || src.slice(i, i + 2) === '\\}') {
              parent.appendChild(el('span', 'agy-math-op', src[i + 1]));
              i += 2;
            } else if (src.slice(i, i + 6) === '\\lvert' || src.slice(i, i + 6) === '\\rvert') {
              parent.appendChild(el('span', 'agy-math-op', '|'));
              i += 6;
            } else {
              parent.appendChild(el('span', 'agy-math-op', src[i]));
              i++;
            }
          }
          continue;
        }

        // 8. Environments \begin{...} ... \end{...}
        if (cmd === 'begin') {
          const envArg = readLatexArgument(src, i);
          const envName = envArg.content.trim();
          const endTag = `\\end{${envName}}`;
          const endIdx = src.indexOf(endTag, envArg.nextPos);
          if (endIdx !== -1) {
            const body = src.slice(envArg.nextPos, endIdx);
            i = endIdx + endTag.length;
            const mat = el('span', 'agy-math-matrix');
            const rows = body.split(/\\\\/).map((r) => r.trim()).filter(Boolean);
            rows.forEach((rStr) => {
              const rowEl = el('span', 'agy-math-matrix-row');
              rStr.split('&').forEach((cellStr) => {
                const cellEl = el('span', 'agy-math-matrix-cell');
                appendLatexNodes(cellEl, cellStr.trim());
                rowEl.appendChild(cellEl);
              });
              mat.appendChild(rowEl);
            });
            parent.appendChild(mat);
            continue;
          }
        }

        // 9. Named trig/limit functions
        if (/^(?:sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lg|exp|lim|sup|inf|max|min|det|dim|ker|deg|gcd|Pr|arg|hom)$/.test(cmd)) {
          parent.appendChild(el('span', 'agy-math-text agy-math-op', cmd));
          continue;
        }

        // 10. Symbol Lookup (Greek letters in italic .agy-math-var, operators in .agy-math-op)
        if (Object.prototype.hasOwnProperty.call(LATEX_SYMBOLS, cmd)) {
          const isGreekLetter = /^(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|ell|hbar|partial|nabla)$/i.test(cmd);
          parent.appendChild(el('span', isGreekLetter ? 'agy-math-var' : 'agy-math-op', LATEX_SYMBOLS[cmd]));
          continue;
        }

        // Fallback: display command name in italic math variable style
        parent.appendChild(el('span', 'agy-math-var', cmd));
        continue;
      }

      // Binary operators / relations spacing
      if ('+-=<>≈≠≤≥≪≫×÷·'.includes(ch)) {
        parent.appendChild(el('span', 'agy-math-op', ch === '-' ? '−' : ch));
        i++;
        continue;
      }

      // Parentheses / brackets in math
      if ('()[]|'.includes(ch)) {
        parent.appendChild(el('span', 'agy-math-op', ch));
        i++;
        continue;
      }

      // Plain characters (variables, numbers, punctuation) rendered in italic math typography
      let runEnd = i + 1;
      while (
        runEnd < src.length &&
        !/[\s\\{}_^+\-=<>()[\]|]/.test(src[runEnd])
      ) {
        runEnd++;
      }
      parent.appendChild(el('span', 'agy-math-var', src.slice(i, runEnd)));
      i = runEnd;
    }
  }

  /**
   * Render a LaTeX math expression into rich KaTeX-like DOM elements.
   * @param {string} expr
   * @param {boolean} isBlock
   * @returns {HTMLElement}
   */
  function renderMathDom(expr, isBlock) {
    const container = el(isBlock ? 'div' : 'span', isBlock ? 'agy-math-block' : 'agy-math-inline');
    appendLatexNodes(container, expr);
    return container;
  }

  /**
   * Append inline Markdown elements (links, file:// pills, images, inline code, bold, italic,
   * strikethrough, inline math, and line breaks) into a target parent HTMLElement.
   * @param {HTMLElement} parent
   * @param {string} text
   * @param {object} callbacks
   */
  function appendInlineNodes(parent, text, callbacks) {
    if (!text) {
      return;
    }

    const pattern = /(!\[([^\]]*)\]\(([^)]+)\))|(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\$\$([\s\S]+?)\$\$|\$((?:\\\$|[^$\n])+?)\$|\\\(([\s\S]+?)\\\))|(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*\n]+)\*|_([^_\n]+)_)|(~~([^~]+)~~)|(<br\s*\/?>)/gi;

    let lastIdx = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parent.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      }

      if (match[1]) {
        const alt = match[2] || '';
        const rawSrc = (match[3] || '').trim();
        const wrap = el('span', 'agy-image-wrap');
        let resolvedSrc = rawSrc;
        if (
          callbacks &&
          callbacks.baseWebviewUri &&
          !/^(https?:|data:|vscode-webview-resource:|file:)/i.test(rawSrc)
        ) {
          resolvedSrc = callbacks.baseWebviewUri.replace(/\/$/, '') + '/' + rawSrc.replace(/^\.\//, '');
        }
        const img = el('img', 'agy-image', null, { src: resolvedSrc, alt });
        wrap.appendChild(img);
        if (alt) {
          wrap.appendChild(el('div', 'agy-image-caption', alt));
        }
        parent.appendChild(wrap);
      } else if (match[4]) {
        const rawLabel = match[5].replace(/^`|`$/g, '');
        const rawHref = (match[6] || '').trim();
        const isFilePill =
          rawHref.startsWith('file://') ||
          /#L\d+/i.test(rawHref) ||
          /\.(py|js|ts|tsx|jsx|go|rs|java|cpp|c|h|md|json|yaml|yml|toml|sh|css|html)(#L\d+(?:-L?\d+)?)?$/i.test(rawHref);

        if (isFilePill) {
          const pill = el('a', 'agy-file-pill', null, {
            href: '#',
            title: rawHref
          });
          pill.appendChild(el('span', 'agy-file-pill-icon', '📄'));
          pill.appendChild(el('span', 'agy-file-pill-name', rawLabel));

          const lineMatch = rawHref.match(/#(L\d+(?:-L?\d+)?)$/i);
          if (lineMatch && !rawLabel.includes(lineMatch[1])) {
            pill.appendChild(el('span', 'agy-file-pill-lines', lineMatch[1]));
          }

          pill.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (callbacks && typeof callbacks.onOpenFileLink === 'function') {
              callbacks.onOpenFileLink(rawHref);
            }
          });
          parent.appendChild(pill);
        } else if (rawHref.startsWith('#')) {
          const anchor = el('a', 'agy-link', rawLabel, { href: rawHref });
          anchor.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const targetEl = document.getElementById(rawHref.slice(1));
            if (targetEl) {
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });
          parent.appendChild(anchor);
        } else {
          const link = el('a', 'agy-link', rawLabel, { href: '#', title: rawHref });
          link.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (callbacks && typeof callbacks.onOpenExternalLink === 'function') {
              callbacks.onOpenExternalLink(rawHref);
            }
          });
          parent.appendChild(link);
        }
      } else if (match[7]) {
        parent.appendChild(el('code', 'agy-inline-code', match[8]));
      } else if (match[9]) {
        const expr = match[10] || match[11] || match[12] || '';
        parent.appendChild(renderMathDom(expr, false));
      } else if (match[13]) {
        const strong = el('strong');
        appendInlineNodes(strong, match[14] || match[15], callbacks);
        parent.appendChild(strong);
      } else if (match[16]) {
        const em = el('em');
        appendInlineNodes(em, match[17] || match[18], callbacks);
        parent.appendChild(em);
      } else if (match[19]) {
        const del = el('del');
        appendInlineNodes(del, match[20], callbacks);
        parent.appendChild(del);
      } else if (match[21]) {
        parent.appendChild(el('br'));
      }

      lastIdx = pattern.lastIndex;
    }

    if (lastIdx < text.length) {
      parent.appendChild(document.createTextNode(text.slice(lastIdx)));
    }
  }

  /**
   * Tokenize a single line of source code into syntax-highlighted span elements.
   * @param {HTMLElement} parent
   * @param {string} lineText
   */
  function appendSyntaxHighlightedLine(parent, lineText) {
    if (!lineText) {
      parent.appendChild(document.createTextNode(' '));
      return;
    }

    const tokenPattern = /(#.*$|\/\/.*$|--\s.*$)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(@[A-Za-z_][A-Za-z0-9_.]*)|\b(def|class|return|import|from|as|if|elif|else|for|while|in|not|and|or|is|None|True|False|async|await|with|try|except|finally|raise|yield|lambda|pass|break|continue|SELECT|FROM|WHERE|JOIN|LEFT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|AND|OR|AS|DISTINCT|COUNT|SUM|AVG|MAX|MIN|const|let|var|function|export|default|new|this|typeof|instanceof|interface|type)\b|\b([A-Z][A-Za-z0-9_]+)\b|\b(\d+(?:\.\d+)?)\b|\b([a-z_][A-Za-z0-9_]*)(?=\s*\()/g;

    let lastIdx = 0;
    let m;
    while ((m = tokenPattern.exec(lineText)) !== null) {
      if (m.index > lastIdx) {
        parent.appendChild(document.createTextNode(lineText.slice(lastIdx, m.index)));
      }
      if (m[1]) {
        parent.appendChild(el('span', 'tok-com', m[1]));
      } else if (m[2]) {
        parent.appendChild(el('span', 'tok-str', m[2]));
      } else if (m[3]) {
        parent.appendChild(el('span', 'tok-dec', m[3]));
      } else if (m[4]) {
        parent.appendChild(el('span', 'tok-kw', m[4]));
      } else if (m[5]) {
        parent.appendChild(el('span', 'tok-type', m[5]));
      } else if (m[6]) {
        parent.appendChild(el('span', 'tok-num', m[6]));
      } else if (m[7]) {
        parent.appendChild(el('span', 'tok-fn', m[7]));
      }
      lastIdx = tokenPattern.lastIndex;
    }

    if (lastIdx < lineText.length) {
      parent.appendChild(document.createTextNode(lineText.slice(lastIdx)));
    }
  }

  /**
   * Compute intersection point on the border of a rectangle centered at (cx, cy) with size (w, h)
   * towards target point (tx, ty).
   */
  function getRectBorderPoint(cx, cy, w, h, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) {
      return { x: cx, y: cy };
    }
    const hw = w / 2;
    const hh = h / 2;
    const scaleX = Math.abs(dx) > 0.0001 ? hw / Math.abs(dx) : Infinity;
    const scaleY = Math.abs(dy) > 0.0001 ? hh / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);
    return {
      x: cx + dx * scale,
      y: cy + dy * scale
    };
  }

  /**
   * Parse and render Mermaid diagrams (flowchart/graph, erDiagram, sequenceDiagram,
   * stateDiagram, xychart-beta) into interactive SVG elements.
   * @param {string} code
   * @returns {{ svg: SVGElement, diagramType: string }}
   */
  function renderMermaidSvg(code) {
    const rawLines = String(code || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('%%'));

    const firstLine = rawLines[0] || '';
    let diagramType = 'Flowchart';
    if (/^erDiagram\b/i.test(firstLine)) {
      diagramType = 'ER Diagram';
    } else if (/^sequenceDiagram\b/i.test(firstLine)) {
      diagramType = 'Sequence Diagram';
    } else if (/^classDiagram\b/i.test(firstLine)) {
      diagramType = 'Class Diagram';
    } else if (/^xychart(-beta)?\b/i.test(firstLine)) {
      diagramType = 'XY Chart';
    } else if (/^pie\b/i.test(firstLine)) {
      diagramType = 'Pie Chart';
    } else if (/^stateDiagram/i.test(firstLine)) {
      diagramType = 'State Diagram';
    }

    // Use Antigravity IDE's exact native Mermaid engine (ELK + Craft Docs beautiful-mermaid) when in Webview DOM
    if (
      typeof globalThis.renderAntigravityMermaidSvg === 'function' &&
      typeof DOMParser !== 'undefined' &&
      typeof document !== 'undefined' &&
      typeof document.importNode === 'function'
    ) {
      try {
        const isLight =
          Boolean(document.body && document.body.classList && document.body.classList.contains('vscode-light'));
        const svgStr = globalThis.renderAntigravityMermaidSvg(code, isLight);
        const parsedDoc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
        const svgNode = parsedDoc && parsedDoc.documentElement;
        if (svgNode && svgNode.tagName && svgNode.tagName.toLowerCase() === 'svg') {
          return {
            diagramType,
            svg: document.importNode(svgNode, true)
          };
        }
      } catch (_err) {
        // Fallback to built-in SVG builder if custom DSL fails
      }
    }

    if (/^erDiagram\b/i.test(firstLine)) {
      return {
        diagramType: 'ER Diagram',
        svg: renderErDiagramSvg(rawLines.slice(1))
      };
    }

    if (/^sequenceDiagram\b/i.test(firstLine)) {
      return {
        diagramType: 'Sequence Diagram',
        svg: renderSequenceDiagramSvg(rawLines.slice(1))
      };
    }

    if (/^xychart-beta\b/i.test(firstLine)) {
      return {
        diagramType: 'XY Chart',
        svg: renderXyChartSvg(rawLines.slice(1))
      };
    }

    return {
      diagramType,
      svg: renderFlowchartSvg(rawLines)
    };
  }

  /**
   * Render Mermaid Flowchart / Graph (LR, TD, subgraphs, node shapes, styled nodes, edges) to SVG.
   * @param {string[]} lines
   * @returns {SVGElement}
   */
  function renderFlowchartSvg(lines) {
    const header = lines[0] || 'flowchart TD';
    const isHorizontal = /\b(LR|RL)\b/i.test(header);

    const nodes = new Map();
    const edges = [];
    const subgraphs = [];
    const nodeStyles = new Map();
    let currentSubgraph = null;

    function cleanLabel(lbl) {
      return String(lbl)
        .replace(/^["']|["']$/g, '')
        .split(/<br\s*\/?>|\\n/i)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    function ensureNode(id, rawLabel, shape) {
      const cleanId = id.trim();
      if (!cleanId) return null;
      if (!nodes.has(cleanId)) {
        nodes.set(cleanId, {
          id: cleanId,
          label: rawLabel ? cleanLabel(rawLabel) : [cleanId],
          shape: shape || 'rect',
          subgraph: currentSubgraph ? currentSubgraph.id : null
        });
      } else if (rawLabel) {
        const existing = nodes.get(cleanId);
        existing.label = cleanLabel(rawLabel);
        if (shape) existing.shape = shape;
      }
      if (currentSubgraph && !currentSubgraph.nodeIds.includes(cleanId)) {
        currentSubgraph.nodeIds.push(cleanId);
      }
      return nodes.get(cleanId);
    }

    function parseNodeToken(token) {
      const t = token.trim();
      if (!t) return null;
      if (t === '[*]') {
        return ensureNode('__start_end__', '●', 'circle');
      }

      const mCyl = t.match(/^([A-Za-z0-9_.-]+)\s*\[\((.+)\)\]$/);
      if (mCyl) return ensureNode(mCyl[1], mCyl[2], 'cylinder');

      const mStad = t.match(/^([A-Za-z0-9_.-]+)\s*\(\[(.+)\]\)$/);
      if (mStad) return ensureNode(mStad[1], mStad[2], 'stadium');

      const mCirc = t.match(/^([A-Za-z0-9_.-]+)\s*\(\((.+)\)\)$/);
      if (mCirc) return ensureNode(mCirc[1], mCirc[2], 'circle');

      const mDia = t.match(/^([A-Za-z0-9_.-]+)\s*\{(.+)\}$/);
      if (mDia) return ensureNode(mDia[1], mDia[2], 'diamond');

      const mRect = t.match(/^([A-Za-z0-9_.-]+)\s*\[(.+)\]$/);
      if (mRect) return ensureNode(mRect[1], mRect[2], 'rect');

      const mRound = t.match(/^([A-Za-z0-9_.-]+)\s*\((.+)\)$/);
      if (mRound) return ensureNode(mRound[1], mRound[2], 'round');

      const mPlain = t.match(/^([A-Za-z0-9_.-]+)$/);
      if (mPlain) return ensureNode(mPlain[1], null, 'rect');

      return ensureNode(t.replace(/[^A-Za-z0-9_.-]/g, '_'), t, 'rect');
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (/^(direction|classDef|class|click|linkStyle)\b/i.test(line)) {
        continue;
      }

      const styleMatch = line.match(/^style\s+([A-Za-z0-9_.-]+)\s+(.+)$/i);
      if (styleMatch) {
        const targetId = styleMatch[1];
        const props = {};
        styleMatch[2].split(',').forEach((pair) => {
          const kv = pair.split(':');
          if (kv.length === 2) {
            props[kv[0].trim().toLowerCase()] = kv[1].trim();
          }
        });
        nodeStyles.set(targetId, props);
        continue;
      }

      const sgMatch = line.match(/^subgraph\s+([^\s[]+)(?:\s*\[(.+)\])?(.*)$/i);
      if (sgMatch) {
        const sgId = sgMatch[1].trim();
        const sgTitle = (sgMatch[2] || sgMatch[3] || sgId).replace(/^["']|["']$/g, '').trim();
        currentSubgraph = { id: sgId, title: sgTitle, nodeIds: [] };
        subgraphs.push(currentSubgraph);
        continue;
      }

      if (/^end\b/i.test(line)) {
        currentSubgraph = null;
        continue;
      }

      const arrowRegex = /\s*(<-->|<-\.->|-->|==>|-\.->|---|--[^>]+-->|--[^>]+---)\s*(?:\|([^|]*)\|\s*)?/g;
      if (arrowRegex.test(line)) {
        arrowRegex.lastIndex = 0;
        const parts = [];
        const connectors = [];
        let lastPos = 0;
        let m;
        while ((m = arrowRegex.exec(line)) !== null) {
          parts.push(line.slice(lastPos, m.index));
          let edgeLabel = m[2] ? m[2].trim() : '';
          const rawArrow = m[1];
          const inlineLabelMatch = rawArrow.match(/^--\s*(.+?)\s*(?:-->|---)$/);
          if (inlineLabelMatch && !edgeLabel) {
            edgeLabel = inlineLabelMatch[1].trim();
          }
          connectors.push({
            arrow: rawArrow,
            label: edgeLabel.replace(/^["']|["']$/g, ''),
            bi: rawArrow.startsWith('<'),
            dashed: rawArrow.includes('.')
          });
          lastPos = arrowRegex.lastIndex;
        }
        parts.push(line.slice(lastPos));

        for (let p = 0; p < connectors.length; p++) {
          const leftNode = parseNodeToken(parts[p]);
          const rightNode = parseNodeToken(parts[p + 1]);
          if (leftNode && rightNode) {
            edges.push({
              from: leftNode.id,
              to: rightNode.id,
              label: connectors[p].label,
              bi: connectors[p].bi,
              dashed: connectors[p].dashed
            });
          }
        }
      } else {
        parseNodeToken(line);
      }
    }

    const nodeList = Array.from(nodes.values());
    if (nodeList.length === 0) {
      nodeList.push({ id: 'empty', label: ['Empty Diagram'], shape: 'rect' });
    }

    const inDegree = new Map();
    const adj = new Map();
    nodeList.forEach((n) => {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    });
    edges.forEach((e) => {
      if (adj.has(e.from) && e.from !== e.to) {
        adj.get(e.from).push(e.to);
        inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
      }
    });

    const rankMap = new Map();
    const queue = [];
    nodeList.forEach((n) => {
      if ((inDegree.get(n.id) || 0) === 0) {
        rankMap.set(n.id, 0);
        queue.push(n.id);
      }
    });
    if (queue.length === 0 && nodeList.length > 0) {
      rankMap.set(nodeList[0].id, 0);
      queue.push(nodeList[0].id);
    }

    while (queue.length > 0) {
      const curr = queue.shift();
      const currRank = rankMap.get(curr) || 0;
      const neighbors = adj.get(curr) || [];
      for (let k = 0; k < neighbors.length; k++) {
        const nxt = neighbors[k];
        if (!rankMap.has(nxt) || rankMap.get(nxt) < currRank + 1) {
          if (currRank + 1 < nodeList.length) {
            rankMap.set(nxt, currRank + 1);
            queue.push(nxt);
          }
        }
      }
    }

    nodeList.forEach((n) => {
      if (!rankMap.has(n.id)) {
        rankMap.set(n.id, 0);
      }
    });

    const layers = new Map();
    let maxRank = 0;
    nodeList.forEach((n) => {
      const r = rankMap.get(n.id) || 0;
      if (r > maxRank) maxRank = r;
      if (!layers.has(r)) layers.set(r, []);
      layers.get(r).push(n);
    });

    nodeList.forEach((n) => {
      let maxChars = 6;
      n.label.forEach((lineStr) => {
        let len = 0;
        for (let c = 0; c < lineStr.length; c++) {
          len += lineStr.charCodeAt(c) > 255 ? 1.85 : 1;
        }
        if (len > maxChars) maxChars = len;
      });
      n.width = Math.max(130, Math.min(290, Math.round(maxChars * 8.5 + 36)));
      n.height = Math.max(48, n.label.length * 20 + 26);
      if (n.shape === 'diamond') {
        n.width += 28;
        n.height += 18;
      }
    });

    const layerGapX = isHorizontal ? 250 : 210;
    const layerGapY = isHorizontal ? 115 : 125;
    const padX = 56;
    const padY = 56;

    let maxCanvasX = 420;
    let maxCanvasY = 220;

    for (let r = 0; r <= maxRank; r++) {
      const group = layers.get(r) || [];
      for (let idx = 0; idx < group.length; idx++) {
        const n = group[idx];
        if (isHorizontal) {
          n.cx = padX + r * layerGapX + n.width / 2;
          n.cy = padY + idx * layerGapY + n.height / 2;
        } else {
          n.cx = padX + idx * layerGapX + n.width / 2;
          n.cy = padY + r * layerGapY + n.height / 2;
        }
        if (n.cx + n.width / 2 + padX > maxCanvasX) {
          maxCanvasX = n.cx + n.width / 2 + padX;
        }
        if (n.cy + n.height / 2 + padY > maxCanvasY) {
          maxCanvasY = n.cy + n.height / 2 + padY;
        }
      }
    }

    const svg = svgEl('svg', {
      viewBox: `0 0 ${Math.ceil(maxCanvasX)} ${Math.ceil(maxCanvasY)}`,
      width: Math.ceil(maxCanvasX),
      height: Math.ceil(maxCanvasY)
    });

    const defs = svgEl('defs');
    const markerEnd = svgEl('marker', {
      id: 'agy-arrow-end',
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '6',
      markerHeight: '6',
      orient: 'auto-start-reverse'
    });
    markerEnd.appendChild(svgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: '#60a5fa' }));
    defs.appendChild(markerEnd);
    svg.appendChild(defs);

    // 1. Subgraph background boxes
    subgraphs.forEach((sg) => {
      const sgNodes = sg.nodeIds.map((id) => nodes.get(id)).filter(Boolean);
      if (sgNodes.length === 0) return;
      const sgStyle = nodeStyles.get(sg.id) || {};
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      sgNodes.forEach((n) => {
        minX = Math.min(minX, n.cx - n.width / 2 - 20);
        minY = Math.min(minY, n.cy - n.height / 2 - 32);
        maxX = Math.max(maxX, n.cx + n.width / 2 + 20);
        maxY = Math.max(maxY, n.cy + n.height / 2 + 18);
      });
      svg.appendChild(
        svgEl('rect', {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          rx: 10,
          fill: sgStyle.fill ? `${sgStyle.fill}33` : 'rgba(96, 165, 250, 0.06)',
          stroke: sgStyle.stroke || 'rgba(148, 163, 184, 0.4)',
          'stroke-width': '1.5',
          'stroke-dasharray': '5,4'
        })
      );
      svg.appendChild(
        svgEl(
          'text',
          {
            x: minX + 14,
            y: minY + 20,
            fill: sgStyle.stroke || '#94a3b8',
            'font-size': '12',
            'font-weight': '700'
          },
          sg.title
        )
      );
    });

    const edgeLabelsLayer = svgEl('g');

    // 2. Edges
    edges.forEach((e) => {
      const fromNode = nodes.get(e.from);
      const toNode = nodes.get(e.to);
      if (!fromNode || !toNode) return;

      const p1 = getRectBorderPoint(fromNode.cx, fromNode.cy, fromNode.width, fromNode.height, toNode.cx, toNode.cy);
      const p2 = getRectBorderPoint(toNode.cx, toNode.cy, toNode.width + 8, toNode.height + 8, fromNode.cx, fromNode.cy);

      const cx1 = (p1.x + p2.x) / 2;
      const cy1 = p1.y;
      const cx2 = (p1.x + p2.x) / 2;
      const cy2 = p2.y;
      const pathAttrs = {
        d: `M ${p1.x} ${p1.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p2.x} ${p2.y}`,
        fill: 'none',
        stroke: '#60a5fa',
        'stroke-width': '1.85',
        'marker-end': 'url(#agy-arrow-end)'
      };
      if (e.bi) {
        pathAttrs['marker-start'] = 'url(#agy-arrow-end)';
      }
      if (e.dashed) {
        pathAttrs['stroke-dasharray'] = '5,4';
      }
      svg.appendChild(svgEl('path', pathAttrs));

      if (e.label) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        let charUnits = 0;
        for (let c = 0; c < e.label.length; c++) {
          charUnits += e.label.charCodeAt(c) > 255 ? 1.8 : 1;
        }
        const lblWidth = Math.max(48, Math.round(charUnits * 7.2 + 16));
        edgeLabelsLayer.appendChild(
          svgEl('rect', {
            x: mx - lblWidth / 2,
            y: my - 11,
            width: lblWidth,
            height: 20,
            rx: 5,
            fill: '#0f172a',
            stroke: '#3b82f6',
            'stroke-width': '1.2'
          })
        );
        edgeLabelsLayer.appendChild(
          svgEl(
            'text',
            {
              x: mx,
              y: my + 3,
              'text-anchor': 'middle',
              fill: '#e2e8f0',
              'font-size': '11'
            },
            e.label
          )
        );
      }
    });

    // 3. Nodes
    nodeList.forEach((n) => {
      const g = svgEl('g');
      const customStyle = nodeStyles.get(n.id) || {};
      const fill = customStyle.fill || '#1e293b';
      const stroke = customStyle.stroke || '#475569';
      const textColor = customStyle.color || '#f1f5f9';

      const x = n.cx - n.width / 2;
      const y = n.cy - n.height / 2;

      if (n.shape === 'diamond') {
        const pts = [
          `${n.cx},${y}`,
          `${x + n.width},${n.cy}`,
          `${n.cx},${y + n.height}`,
          `${x},${n.cy}`
        ].join(' ');
        g.appendChild(svgEl('polygon', { points: pts, fill, stroke, 'stroke-width': '1.75' }));
      } else if (n.shape === 'stadium') {
        g.appendChild(
          svgEl('rect', {
            x,
            y,
            width: n.width,
            height: n.height,
            rx: n.height / 2,
            fill,
            stroke,
            'stroke-width': '1.75'
          })
        );
      } else if (n.shape === 'cylinder') {
        g.appendChild(
          svgEl('rect', {
            x,
            y: y + 6,
            width: n.width,
            height: n.height - 6,
            rx: 8,
            fill,
            stroke,
            'stroke-width': '1.75'
          })
        );
        g.appendChild(
          svgEl('ellipse', {
            cx: n.cx,
            cy: y + 8,
            rx: n.width / 2,
            ry: 7,
            fill,
            stroke,
            'stroke-width': '1.75'
          })
        );
      } else {
        g.appendChild(
          svgEl('rect', {
            x,
            y,
            width: n.width,
            height: n.height,
            rx: n.shape === 'round' ? 12 : 7,
            fill,
            stroke,
            'stroke-width': '1.75'
          })
        );
      }

      const startY = n.cy - ((n.label.length - 1) * 18) / 2 + 4;
      n.label.forEach((lineText, idx) => {
        g.appendChild(
          svgEl(
            'text',
            {
              x: n.cx,
              y: startY + idx * 18,
              'text-anchor': 'middle',
              fill: textColor,
              'font-size': '12.5',
              'font-weight': idx === 0 && n.label.length > 1 ? '600' : '500'
            },
            lineText
          )
        );
      });

      svg.appendChild(g);
    });

    // 4. Foreground edge labels so they are never covered by nodes
    svg.appendChild(edgeLabelsLayer);

    return svg;
  }

  /**
   * Render Mermaid ER Diagram (`erDiagram`) to SVG with non-overlapping curved routing
   * and foreground relation badges.
   * @param {string[]} lines
   * @returns {SVGElement}
   */
  function renderErDiagramSvg(lines) {
    const entities = new Map();
    const relations = [];
    let activeEntity = null;

    function getEntity(name) {
      const clean = name.trim();
      if (!entities.has(clean)) {
        entities.set(clean, { name: clean, fields: [] });
      }
      return entities.get(clean);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (activeEntity) {
        if (line === '}') {
          activeEntity = null;
        } else {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            activeEntity.fields.push({
              type: parts[0],
              name: parts[1],
              key: parts[2] || ''
            });
          }
        }
        continue;
      }

      const blockOpen = line.match(/^([A-Za-z0-9_-]+)\s*\{\s*$/);
      if (blockOpen) {
        activeEntity = getEntity(blockOpen[1]);
        continue;
      }

      const relMatch = line.match(/^([A-Za-z0-9_-]+)\s+([|o}{]+--[|o}{]+)\s+([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
      if (relMatch) {
        getEntity(relMatch[1]);
        getEntity(relMatch[3]);
        relations.push({
          from: relMatch[1],
          card: relMatch[2],
          to: relMatch[3],
          label: relMatch[4].replace(/^["']|["']$/g, '')
        });
      }
    }

    const list = Array.from(entities.values());
    const cols = Math.min(2, Math.max(1, list.length));
    const boxW = 240;
    const gapX = 380;
    const padX = 56;
    const padY = 64;

    // Calculate each row's Y dynamically so tall tables never overlap the next row
    let currentY = padY;
    const numRows = Math.ceil(list.length / cols);
    let maxCanvasW = padX * 2 + cols * boxW + Math.max(0, cols - 1) * (gapX - boxW);

    for (let r = 0; r < numRows; r++) {
      let rowMaxH = 90;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= list.length) break;
        const ent = list[idx];
        ent.col = c;
        ent.row = r;
        ent.w = boxW;
        ent.h = 38 + Math.max(1, ent.fields.length) * 24 + 12;
        ent.x = padX + c * gapX;
        ent.y = currentY;
        ent.cx = ent.x + ent.w / 2;
        ent.cy = ent.y + ent.h / 2;
        if (ent.h > rowMaxH) {
          rowMaxH = ent.h;
        }
      }
      currentY += rowMaxH + 110;
    }

    const totalW = Math.max(560, maxCanvasW);
    const totalH = Math.max(260, currentY - 40);

    const svg = svgEl('svg', {
      viewBox: `0 0 ${totalW} ${totalH}`,
      width: totalW,
      height: totalH
    });

    const linesLayer = svgEl('g');
    const boxesLayer = svgEl('g');
    const labelsLayer = svgEl('g');

    // 1. Relation curves & foreground labels
    relations.forEach((rel, relIdx) => {
      const a = entities.get(rel.from);
      const b = entities.get(rel.to);
      if (!a || !b) return;

      const p1 = getRectBorderPoint(a.cx, a.cy, a.w, a.h, b.cx, b.cy);
      const p2 = getRectBorderPoint(b.cx, b.cy, b.w, b.h, a.cx, a.cy);

      let pathD = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
      let labelX = (p1.x + p2.x) / 2;
      let labelY = (p1.y + p2.y) / 2;

      if (a.row === b.row && Math.abs(a.col - b.col) > 1) {
        // Curve above the intermediate box
        const ctrlY = Math.min(a.y, b.y) - 44;
        pathD = `M ${a.cx} ${a.y} Q ${(a.cx + b.cx) / 2} ${ctrlY} ${b.cx} ${b.y}`;
        labelX = (a.cx + b.cx) / 2;
        labelY = ctrlY + 14;
      } else if (Math.abs(p1.y - p2.y) < 15) {
        // Slight vertical offset if multiple horizontal relations exist
        const curveOffset = (relIdx % 2 === 0 ? -1 : 1) * 14;
        pathD = `M ${p1.x} ${p1.y} Q ${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2 + curveOffset} ${p2.x} ${p2.y}`;
        labelY += curveOffset * 0.5;
      }

      linesLayer.appendChild(
        svgEl('path', {
          d: pathD,
          fill: 'none',
          stroke: '#60a5fa',
          'stroke-width': '2'
        })
      );

      // Endpoint dots
      linesLayer.appendChild(svgEl('circle', { cx: p1.x, cy: p1.y, r: 3.5, fill: '#60a5fa' }));
      linesLayer.appendChild(svgEl('circle', { cx: p2.x, cy: p2.y, r: 3.5, fill: '#60a5fa' }));

      let charUnits = 0;
      for (let c = 0; c < rel.label.length; c++) {
        charUnits += rel.label.charCodeAt(c) > 255 ? 1.8 : 1;
      }
      const lblW = Math.max(64, Math.round(charUnits * 7.2 + 18));

      labelsLayer.appendChild(
        svgEl('rect', {
          x: labelX - lblW / 2,
          y: labelY - 12,
          width: lblW,
          height: 22,
          rx: 5,
          fill: '#0f172a',
          stroke: '#3b82f6',
          'stroke-width': '1.25'
        })
      );
      labelsLayer.appendChild(
        svgEl(
          'text',
          {
            x: labelX,
            y: labelY + 3,
            'text-anchor': 'middle',
            fill: '#93c5fd',
            'font-size': '11.5',
            'font-weight': '500'
          },
          rel.label
        )
      );
    });

    // 2. Entity table cards
    list.forEach((ent) => {
      const g = svgEl('g');
      g.appendChild(
        svgEl('rect', {
          x: ent.x,
          y: ent.y,
          width: ent.w,
          height: ent.h,
          rx: 8,
          fill: '#1e293b',
          stroke: '#475569',
          'stroke-width': '1.75'
        })
      );
      g.appendChild(
        svgEl('rect', {
          x: ent.x,
          y: ent.y,
          width: ent.w,
          height: 34,
          rx: 8,
          fill: '#1e3a5f'
        })
      );
      g.appendChild(
        svgEl(
          'text',
          {
            x: ent.x + ent.w / 2,
            y: ent.y + 22,
            'text-anchor': 'middle',
            fill: '#f8fafc',
            'font-size': '13',
            'font-weight': '700'
          },
          ent.name
        )
      );

      if (ent.fields.length === 0) {
        g.appendChild(
          svgEl(
            'text',
            {
              x: ent.x + ent.w / 2,
              y: ent.y + 58,
              'text-anchor': 'middle',
              fill: '#64748b',
              'font-size': '11.5',
              'font-style': 'italic'
            },
            '(实体表 / Entity)'
          )
        );
      } else {
        ent.fields.forEach((f, fIdx) => {
          const fy = ent.y + 54 + fIdx * 24;
          g.appendChild(
            svgEl(
              'text',
              {
                x: ent.x + 12,
                y: fy,
                fill: '#38bdf8',
                'font-size': '11.5',
                'font-family': 'monospace'
              },
              f.type
            )
          );
          g.appendChild(
            svgEl(
              'text',
              {
                x: ent.x + 98,
                y: fy,
                fill: '#e2e8f0',
                'font-size': '12'
              },
              f.name
            )
          );
          if (f.key) {
            g.appendChild(
              svgEl(
                'text',
                {
                  x: ent.x + ent.w - 12,
                  y: fy,
                  'text-anchor': 'end',
                  fill: '#fbbf24',
                  'font-size': '10.5',
                  'font-weight': '700'
                },
                f.key
              )
            );
          }
        });
      }

      boxesLayer.appendChild(g);
    });

    svg.appendChild(linesLayer);
    svg.appendChild(boxesLayer);
    svg.appendChild(labelsLayer);

    return svg;
  }

  /**
   * Render Mermaid Sequence Diagram (`sequenceDiagram`) to SVG.
   * @param {string[]} lines
   * @returns {SVGElement}
   */
  function renderSequenceDiagramSvg(lines) {
    const participants = [];
    const partMap = new Map();
    const messages = [];

    function ensureParticipant(id, label) {
      if (!partMap.has(id)) {
        const obj = { id, label: label || id };
        partMap.set(id, obj);
        participants.push(obj);
      } else if (label) {
        partMap.get(id).label = label;
      }
    }

    lines.forEach((line) => {
      const pMatch = line.match(/^(?:participant|actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/i);
      if (pMatch) {
        ensureParticipant(pMatch[1], pMatch[2]);
        return;
      }
      const mMatch = line.match(/^([^\s-]+)\s*(->>|-->>|->|-->)\s*([^\s:]+)\s*:\s*(.+)$/);
      if (mMatch) {
        ensureParticipant(mMatch[1]);
        ensureParticipant(mMatch[3]);
        messages.push({
          from: mMatch[1],
          arrow: mMatch[2],
          to: mMatch[3],
          text: mMatch[4]
        });
      }
    });

    const colGap = 180;
    const totalW = Math.max(400, participants.length * colGap + 60);
    const totalH = Math.max(220, 110 + messages.length * 48);

    const svg = svgEl('svg', { viewBox: `0 0 ${totalW} ${totalH}`, width: totalW, height: totalH });

    participants.forEach((p, idx) => {
      p.cx = 90 + idx * colGap;
      svg.appendChild(
        svgEl('line', {
          x1: p.cx,
          y1: 54,
          x2: p.cx,
          y2: totalH - 24,
          stroke: '#475569',
          'stroke-dasharray': '4,4'
        })
      );
      svg.appendChild(
        svgEl('rect', {
          x: p.cx - 65,
          y: 16,
          width: 130,
          height: 36,
          rx: 6,
          fill: '#1e293b',
          stroke: '#60a5fa'
        })
      );
      svg.appendChild(
        svgEl(
          'text',
          {
            x: p.cx,
            y: 39,
            'text-anchor': 'middle',
            fill: '#f8fafc',
            'font-size': '12.5',
            'font-weight': '600'
          },
          p.label
        )
      );
    });

    messages.forEach((m, idx) => {
      const fromP = partMap.get(m.from);
      const toP = partMap.get(m.to);
      if (!fromP || !toP) return;
      const y = 90 + idx * 46;
      svg.appendChild(
        svgEl('line', {
          x1: fromP.cx,
          y1: y,
          x2: toP.cx,
          y2: y,
          stroke: '#60a5fa',
          'stroke-width': '1.75',
          'stroke-dasharray': m.arrow.startsWith('--') ? '5,4' : ''
        })
      );
      svg.appendChild(
        svgEl(
          'text',
          {
            x: (fromP.cx + toP.cx) / 2,
            y: y - 7,
            'text-anchor': 'middle',
            fill: '#e2e8f0',
            'font-size': '11.5'
          },
          m.text
        )
      );
    });

    return svg;
  }

  /**
   * Render Mermaid XY Chart (`xychart-beta`) to SVG.
   * @param {string[]} lines
   * @returns {SVGElement}
   */
  function renderXyChartSvg(lines) {
    let title = '';
    let labels = [];
    let values = [];

    lines.forEach((l) => {
      const tMatch = l.match(/^title\s+"?([^"]+)"?$/i);
      if (tMatch) title = tMatch[1];
      const xMatch = l.match(/^x-axis\s+\[(.+)\]$/i);
      if (xMatch) {
        labels = xMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      }
      const bMatch = l.match(/^(?:bar|line)\s+\[(.+)\]$/i);
      if (bMatch) {
        values = bMatch[1].split(',').map((n) => parseFloat(n.trim()) || 0);
      }
    });

    const w = 520;
    const h = 260;
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h });
    if (title) {
      svg.appendChild(
        svgEl('text', { x: w / 2, y: 24, 'text-anchor': 'middle', fill: '#f8fafc', 'font-weight': '600' }, title)
      );
    }
    const maxVal = Math.max(1, ...values);
    const barW = Math.min(48, Math.floor(380 / Math.max(1, values.length)));
    values.forEach((v, idx) => {
      const bh = Math.round((v / maxVal) * 160);
      const bx = 70 + idx * (barW + 24);
      const by = 210 - bh;
      svg.appendChild(svgEl('rect', { x: bx, y: by, width: barW, height: bh, rx: 4, fill: '#3b82f6' }));
      if (labels[idx]) {
        svg.appendChild(
          svgEl('text', { x: bx + barW / 2, y: 230, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': '11' }, labels[idx])
        );
      }
    });
    return svg;
  }

  /**
   * Render a single AST block's visual DOM representation into `targetContainer`.
   * @param {HTMLElement} targetContainer
   * @param {any} block
   * @param {object} callbacks
   */
  function renderSingleBlockContent(targetContainer, block, callbacks) {
    switch (block.type) {
      case 'heading': {
        const wrap = el('div', 'agy-heading-wrap', null, { id: block.id || '' });
        const hTag = `h${Math.min(6, Math.max(1, block.level))}`;
        const hNode = el(hTag, 'agy-heading');
        appendInlineNodes(hNode, block.text, callbacks);
        wrap.appendChild(hNode);
        targetContainer.appendChild(wrap);
        break;
      }

      case 'paragraph': {
        const p = el('p', 'agy-p');
        appendInlineNodes(p, block.text, callbacks);
        targetContainer.appendChild(p);
        break;
      }

      case 'hr': {
        targetContainer.appendChild(el('hr', 'agy-hr'));
        break;
      }

      case 'alert': {
        const typeLower = block.alertType.toLowerCase();
        const iconMap = {
          note: 'ℹ️',
          tip: '💡',
          important: '⚡',
          warning: '⚠️',
          caution: '🛑'
        };
        const alertCard = el('div', `agy-alert alert-${typeLower}`);
        const header = el('div', 'agy-alert-header');
        header.appendChild(el('span', '', iconMap[typeLower] || 'ℹ️'));
        header.appendChild(el('span', '', block.alertType));
        alertCard.appendChild(header);

        const body = el('div', 'agy-alert-body');
        const nestedAst = parseMarkdownToAst(block.body);
        nestedAst.blocks.forEach((b) => renderSingleBlockContent(body, b, callbacks));
        alertCard.appendChild(body);
        targetContainer.appendChild(alertCard);
        break;
      }

      case 'blockquote': {
        const bq = el('blockquote', 'agy-blockquote');
        const nestedAst = parseMarkdownToAst(block.body);
        nestedAst.blocks.forEach((b) => renderSingleBlockContent(bq, b, callbacks));
        targetContainer.appendChild(bq);
        break;
      }

      case 'list': {
        const listEl = el(block.ordered ? 'ol' : 'ul', 'agy-list');
        block.items.forEach((item) => {
          const li = el('li', item.isTask ? 'agy-task-item' : '', null, {
            'data-line': item.lineIndex + 1
          });
          if (item.indent >= 2) {
            li.style.marginLeft = `${Math.min(4, Math.floor(item.indent / 2)) * 18}px`;
          }
          if (item.isTask) {
            const checkbox = el('input', 'agy-task-checkbox', null, { type: 'checkbox' });
            checkbox.checked = Boolean(item.checked);
            checkbox.addEventListener('click', (ev) => ev.stopPropagation());
            checkbox.addEventListener('change', () => {
              if (callbacks && typeof callbacks.onToggleTaskItem === 'function') {
                callbacks.onToggleTaskItem(item.lineIndex);
              }
            });
            li.appendChild(checkbox);
          }
          const span = el('span');
          appendInlineNodes(span, item.text, callbacks);
          li.appendChild(span);
          listEl.appendChild(li);
        });
        targetContainer.appendChild(listEl);
        break;
      }

      case 'table': {
        const wrap = el('div', 'agy-table-wrap');
        const table = el('table', 'agy-table');
        const thead = el('thead');
        const trHead = el('tr');
        block.headers.forEach((hText, colIdx) => {
          const th = el('th', '', null, {
            style: `text-align: ${block.alignments[colIdx] || 'left'}`
          });
          appendInlineNodes(th, hText, callbacks);
          trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = el('tbody');
        block.rows.forEach((rowCells, rIdx) => {
          const tr = el('tr', '', null, {
            'data-line': (block.startLine || 0) + 3 + rIdx
          });
          block.headers.forEach((_h, colIdx) => {
            const td = el('td', '', null, {
              style: `text-align: ${block.alignments[colIdx] || 'left'}`
            });
            appendInlineNodes(td, rowCells[colIdx] || '', callbacks);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        targetContainer.appendChild(wrap);
        break;
      }

      case 'code': {
        const card = el('div', 'agy-code-card');
        const header = el('div', 'agy-code-header');
        header.appendChild(el('span', 'agy-code-lang', block.lang || 'text'));

        const copyBtn = el('button', 'agy-copy-btn', '复制代码 (Copy)');
        copyBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (callbacks && typeof callbacks.onCopyText === 'function') {
            callbacks.onCopyText(block.code);
            copyBtn.textContent = '✓ 已复制';
            setTimeout(() => {
              copyBtn.textContent = '复制代码 (Copy)';
            }, 1500);
          }
        });
        header.appendChild(copyBtn);
        card.appendChild(header);

        const pre = el('pre', 'agy-code-pre');
        const grid = el('div', 'agy-code-table');
        const codeLines = block.code.split('\n');
        const baseCodeLine = (block.codeStartLine !== undefined ? block.codeStartLine : (block.startLine || 0) + 1) + 1;
        codeLines.forEach((lineText, idx) => {
          const docLine = baseCodeLine + idx;
          grid.appendChild(el('span', 'agy-line-num', String(idx + 1), { 'data-line': docLine }));
          const codeLineSpan = el('span', 'agy-line-code', null, { 'data-line': docLine });
          appendSyntaxHighlightedLine(codeLineSpan, lineText);
          grid.appendChild(codeLineSpan);
        });
        pre.appendChild(grid);
        card.appendChild(pre);
        targetContainer.appendChild(card);
        break;
      }

      case 'mermaid': {
        const card = el('div', 'agy-mermaid-card');
        const rendered = renderMermaidSvg(block.code);
        const toolbar = el('div', 'agy-mermaid-toolbar');
        toolbar.appendChild(
          el('span', 'agy-mermaid-title', `◇ Mermaid · ${rendered.diagramType}`)
        );
        card.appendChild(toolbar);

        const viewport = el('div', 'agy-mermaid-viewport');
        const stage = el('div', 'agy-mermaid-stage');
        stage.appendChild(rendered.svg);
        viewport.appendChild(stage);
        card.appendChild(viewport);

        let scale = 1;
        let panX = 0;
        let panY = 0;
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let startPanX = 0;
        let startPanY = 0;

        const applyTransform = () => {
          stage.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${scale})`;
        };

        const updateScale = (nextScale) => {
          scale = Math.min(3.0, Math.max(0.35, nextScale));
          applyTransform();
        };

        // Interactive Mouse Drag Panning
        viewport.addEventListener('mousedown', (ev) => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          isDragging = true;
          dragStartX = ev.clientX;
          dragStartY = ev.clientY;
          startPanX = panX;
          startPanY = panY;
          viewport.classList.add('is-dragging');
          stage.classList.add('is-dragging');
        });

        if (typeof window !== 'undefined') {
          window.addEventListener('mousemove', (ev) => {
            if (!isDragging) return;
            panX = startPanX + (ev.clientX - dragStartX);
            panY = startPanY + (ev.clientY - dragStartY);
            applyTransform();
          });

          window.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            viewport.classList.remove('is-dragging');
            stage.classList.remove('is-dragging');
          });
        }

        // Mouse Wheel Zoom inside Mermaid Viewport
        viewport.addEventListener(
          'wheel',
          (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const delta = ev.deltaY < 0 ? 0.12 : -0.12;
            updateScale(scale + delta);
          },
          { passive: false }
        );

        targetContainer.appendChild(card);
        break;
      }

      case 'carousel': {
        const slides = block.slides.length > 0 ? block.slides : ['(Empty Carousel)'];
        let activeSlide = 0;

        const card = el('div', 'agy-carousel');
        const header = el('div', 'agy-carousel-header');
        const label = el('span', 'agy-carousel-label', `Carousel · Slide 1 / ${slides.length}`);
        header.appendChild(label);

        const nav = el('div', 'agy-carousel-nav');
        const prevBtn = el('button', 'agy-mermaid-btn', '◀ Prev');
        const dotsWrap = el('div', 'agy-carousel-dots');
        const nextBtn = el('button', 'agy-mermaid-btn', 'Next ▶');

        const body = el('div', 'agy-carousel-body');

        const renderSlide = (idx) => {
          activeSlide = (idx + slides.length) % slides.length;
          label.textContent = `Carousel · Slide ${activeSlide + 1} / ${slides.length}`;
          body.replaceChildren();
          const slideAst = parseMarkdownToAst(slides[activeSlide]);
          slideAst.blocks.forEach((b) => renderSingleBlockContent(body, b, callbacks));

          dotsWrap.replaceChildren();
          slides.forEach((_s, dIdx) => {
            const dot = el('button', `agy-carousel-dot${dIdx === activeSlide ? ' active' : ''}`);
            dot.addEventListener('click', (ev) => {
              ev.stopPropagation();
              renderSlide(dIdx);
            });
            dotsWrap.appendChild(dot);
          });
        };

        prevBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          renderSlide(activeSlide - 1);
        });
        nextBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          renderSlide(activeSlide + 1);
        });

        nav.appendChild(prevBtn);
        nav.appendChild(dotsWrap);
        nav.appendChild(nextBtn);
        header.appendChild(nav);

        card.appendChild(header);
        card.appendChild(body);
        renderSlide(0);
        targetContainer.appendChild(card);
        break;
      }

      case 'mathBlock': {
        targetContainer.appendChild(renderMathDom(block.expression, true));
        break;
      }

      default:
        break;
    }
  }

  /**
   * Create an interactive insert divider line (+ 插入内容) between blocks or at the end/start.
   * Clicking it opens an empty inline editor without inserting any placeholder text.
   */
  function createInsertDivider(insertLineIndex, callbacks, container) {
    const divider = el('div', 'agy-insert-divider', null, {
      title: '点击在此处插入新 Markdown 内容'
    });
    const btn = el('button', 'agy-insert-btn', '+ 插入内容');
    divider.appendChild(btn);

    const onTriggerInsert = (ev) => {
      ev.stopPropagation();
      const existing = container.querySelector('.agy-new-block-editor');
      if (existing) {
        const ta = existing.querySelector('textarea');
        if (ta) ta.focus();
        return;
      }

      const insertWrapper = el('div', 'agy-editable-block is-editing-inplace agy-new-block-editor');
      const textarea = el('textarea', 'agy-inplace-editor', '', {
        placeholder: '在此输入 Markdown 内容（按 Esc 或点击外部保存，支持公式、Mermaid、段落）...'
      });
      textarea.rows = 2;
      insertWrapper.appendChild(textarea);
      divider.parentElement.insertBefore(insertWrapper, divider.nextSibling);

      const autoFitHeight = () => {
        textarea.style.height = 'auto';
        if (textarea.scrollHeight > 0) {
          textarea.style.height = `${textarea.scrollHeight}px`;
        }
      };
      autoFitHeight();
      textarea.focus();

      let finished = false;
      const finishInsert = (save) => {
        if (finished) return;
        finished = true;
        if (typeof document !== 'undefined' && document.removeEventListener) {
          document.removeEventListener('mousedown', onOutsideClick, true);
        }
        const val = textarea.value.trim();
        insertWrapper.remove();
        if (save && val) {
          if (callbacks && typeof callbacks.onInsertMarkdownBlock === 'function') {
            callbacks.onInsertMarkdownBlock(insertLineIndex, val);
          }
        }
      };

      const onOutsideClick = (e) => {
        if (!insertWrapper.contains(e.target) && e.target !== btn) {
          finishInsert(true);
        }
      };

      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('mousedown', onOutsideClick, true);
      }

      textarea.addEventListener('input', autoFitHeight);
      textarea.addEventListener('blur', () => {
        setTimeout(() => finishInsert(true), 20);
      });
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finishInsert(false);
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          finishInsert(true);
        }
      });
    };

    divider.addEventListener('click', onTriggerInsert);
    btn.addEventListener('click', onTriggerInsert);
    return divider;
  }

  /**
   * Create an inline Hunk Action Banner matching the Antigravity IDE Raw Editor diff bar
   * (`✓ Accept | ✕ Reject | +3 lines, -6 lines`).
   * @param {object} hunk
   * @param {object} callbacks
   * @returns {HTMLElement}
   */
  function createDiffHunkBanner(hunk, callbacks) {
    const banner = el('div', 'agy-diff-hunk-banner', null, {
      'data-hunk-index': hunk.hunkIndex,
      id: `agy-diff-hunk-${hunk.hunkIndex}`
    });

    const acceptBtn = el('button', 'agy-diff-action-btn agy-diff-btn-accept', '✓ Accept', {
      title: '接受此段修改 (快捷键 Alt+Enter)'
    });
    acceptBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (callbacks && typeof callbacks.onAcceptHunk === 'function') {
        callbacks.onAcceptHunk(hunk);
      }
    });

    const sep1 = el('span', 'agy-diff-sep', '|');

    const rejectBtn = el('button', 'agy-diff-action-btn agy-diff-btn-reject', '✕ Reject', {
      title: '还原此段修改 (快捷键 Alt+Shift+Backspace)'
    });
    rejectBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (callbacks && typeof callbacks.onRejectHunk === 'function') {
        callbacks.onRejectHunk(hunk);
      }
    });

    const sep2 = el('span', 'agy-diff-sep', '|');

    banner.appendChild(acceptBtn);
    banner.appendChild(sep1);
    banner.appendChild(rejectBtn);
    banner.appendChild(sep2);

    if (hunk.addedCount > 0) {
      banner.appendChild(el('span', 'agy-diff-stat-add', `+${hunk.addedCount} lines`));
    }
    if (hunk.addedCount > 0 && hunk.removedCount > 0) {
      banner.appendChild(el('span', 'agy-diff-stat-comma', ', '));
    }
    if (hunk.removedCount > 0) {
      banner.appendChild(el('span', 'agy-diff-stat-del', `-${hunk.removedCount} lines`));
    }

    return banner;
  }

  /**
   * Create a display box for deleted lines rendered with red strikethrough styling.
   * @param {object} hunk
   * @returns {HTMLElement}
   */
  function createDiffDeletedContainer(hunk) {
    const box = el('div', 'agy-diff-deleted-container');
    const header = el('div', 'agy-diff-deleted-header');
    header.appendChild(el('span', 'agy-diff-del-icon', '−'));
    header.appendChild(el('span', 'agy-diff-del-label', `已删除 ${hunk.removedCount} 行 (原始版本):`));
    box.appendChild(header);

    const pre = el('pre', 'agy-diff-deleted-content', (hunk.deletedTexts || []).join('\n'));
    box.appendChild(pre);
    return box;
  }

  /**
   * Update the Sticky Diff Review Bar at the top of the preview pane.
   * @param {HTMLElement} stickyBar
   * @param {object | null} diff
   * @param {object} callbacks
   */
  function updateDiffStickyBar(stickyBar, diff, callbacks) {
    if (!stickyBar) return;
    if (!diff || !diff.hasDiff || (diff.addedCount === 0 && diff.removedCount === 0)) {
      stickyBar.style.display = 'none';
      stickyBar.replaceChildren();
      return;
    }

    stickyBar.style.display = 'flex';
    stickyBar.replaceChildren();

    const left = el('div', 'agy-diff-sticky-left');
    const badge = el('span', 'agy-diff-sticky-badge', '✦ AI 修改待审查');
    left.appendChild(badge);

    const acceptAllBtn = el('button', 'agy-diff-action-btn agy-diff-btn-accept', '✓ 全部接受 (Accept All)', {
      title: '接受文件内全部 AI 修改并保存 (Alt+Enter)'
    });
    acceptAllBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (callbacks && typeof callbacks.onAcceptAllDiff === 'function') {
        callbacks.onAcceptAllDiff();
      }
    });
    left.appendChild(acceptAllBtn);

    left.appendChild(el('span', 'agy-diff-sep', '|'));

    const rejectAllBtn = el('button', 'agy-diff-action-btn agy-diff-btn-reject', '✕ 全部拒绝 (Reject All)', {
      title: '还原文件内全部修改至原始版本 (Alt+Shift+Backspace)'
    });
    rejectAllBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (callbacks && typeof callbacks.onRejectAllDiff === 'function') {
        callbacks.onRejectAllDiff();
      }
    });
    left.appendChild(rejectAllBtn);

    left.appendChild(el('span', 'agy-diff-sep', '|'));

    if (diff.addedCount > 0) {
      left.appendChild(el('span', 'agy-diff-stat-add', `+${diff.addedCount} lines`));
    }
    if (diff.addedCount > 0 && diff.removedCount > 0) {
      left.appendChild(el('span', 'agy-diff-stat-comma', ', '));
    }
    if (diff.removedCount > 0) {
      left.appendChild(el('span', 'agy-diff-stat-del', `-${diff.removedCount} lines`));
    }

    const right = el('div', 'agy-diff-sticky-right');
    if (diff.hunks && diff.hunks.length > 0) {
      let navIdx = 0;
      const countLabel = el('span', 'agy-diff-nav-count', `${diff.hunks.length} 处更改`);
      right.appendChild(countLabel);

      const nextBtn = el('button', 'agy-diff-nav-btn', '↓ 下一处', { title: '跳转到下一个修改处 (Alt+J)' });
      nextBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const target = document.getElementById(`agy-diff-hunk-${navIdx}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        navIdx = (navIdx + 1) % diff.hunks.length;
      });
      right.appendChild(nextBtn);

      const prevBtn = el('button', 'agy-diff-nav-btn', '↑ 上一处', { title: '跳转到上一个修改处 (Alt+K)' });
      prevBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        navIdx = (navIdx - 1 + diff.hunks.length) % diff.hunks.length;
        const target = document.getElementById(`agy-diff-hunk-${navIdx}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      right.appendChild(prevBtn);
    }

    stickyBar.appendChild(left);
    stickyBar.appendChild(right);
  }

  /**
   * Render an array of AST blocks into a container DOM element with in-preview live editing wrappers.
   * @param {HTMLElement} container
   * @param {Array<any>} blocks
   * @param {object} callbacks
   */
  function renderBlocksIntoDom(container, blocks, callbacks) {
    if (blocks.length > 0) {
      container.appendChild(createInsertDivider(blocks[0].startLine, callbacks, container));
    }

    const diffHunks = (callbacks && callbacks.diff && callbacks.diff.hunks) || [];
    const hunkPlacementMap = new Map();
    const trailingHunks = [];

    diffHunks.forEach((hunk) => {
      let placed = false;
      for (let b = 0; b < blocks.length; b++) {
        const blk = blocks[b];
        if (hunk.startModLine <= blk.endLine) {
          if (!hunkPlacementMap.has(b)) {
            hunkPlacementMap.set(b, []);
          }
          hunkPlacementMap.get(b).push(hunk);
          placed = true;
          break;
        }
      }
      if (!placed) {
        trailingHunks.push(hunk);
      }
    });

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const startLine1 = (block.startLine || 0) + 1;
      const endLine1 = (block.endLine !== undefined ? block.endLine : block.startLine || 0) + 1;

      // Render any hunk banners and deleted content that precede this block
      if (hunkPlacementMap.has(i)) {
        const hunksForBlock = hunkPlacementMap.get(i);
        hunksForBlock.forEach((hunk) => {
          container.appendChild(createDiffHunkBanner(hunk, callbacks));
          if (hunk.removedCount > 0 && hunk.deletedTexts && hunk.deletedTexts.length > 0) {
            container.appendChild(createDiffDeletedContainer(hunk));
          }
        });
      }

      const wrapper = el('div', 'agy-editable-block', null, {
        'data-start-line': startLine1,
        'data-end-line': endLine1,
        'data-block-index': i
      });

      const isDiffAdded =
        callbacks &&
        callbacks.diff &&
        Array.isArray(callbacks.diff.addedLines) &&
        callbacks.diff.addedLines.some((l) => l >= block.startLine && l <= block.endLine);

      if (isDiffAdded) {
        wrapper.classList.add('agy-diff-added');
      }

      // Hover Action Toolbar (Direct Edit + Send to Chat, positioned outside the block box)
      const toolbar = el('div', 'agy-block-toolbar');
      const editBtn = el('button', 'agy-block-btn', '✎ 直接编辑', {
        title: '在预览界面直接编辑此块并实时渲染 (或双击此块)'
      });
      const chatBtn = el('button', 'agy-block-btn', `📌 引用 L${startLine1}-${endLine1}`, {
        title: '将此段落文件与行号添加到当前开启的 AI 聊天框'
      });

      toolbar.appendChild(editBtn);
      toolbar.appendChild(chatBtn);

      const coveringHunk = diffHunks.find((h) => h.startModLine <= block.endLine && h.endModLine >= block.startLine);
      if (coveringHunk) {
        const acceptHunkBtn = el('button', 'agy-block-btn agy-block-btn-accept', '✓ 接受此段', {
          title: '接受并保留此段 AI 修改'
        });
        acceptHunkBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (callbacks && typeof callbacks.onAcceptHunk === 'function') {
            callbacks.onAcceptHunk(coveringHunk);
          }
        });
        const rejectHunkBtn = el('button', 'agy-block-btn agy-block-btn-reject', '✕ 还原此段', {
          title: '还原此段修改至原始版本'
        });
        rejectHunkBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (callbacks && typeof callbacks.onRejectHunk === 'function') {
            callbacks.onRejectHunk(coveringHunk);
          }
        });
        toolbar.appendChild(acceptHunkBtn);
        toolbar.appendChild(rejectHunkBtn);
      }

      wrapper.appendChild(toolbar);

      const contentBox = el('div', 'agy-block-content');
      renderSingleBlockContent(contentBox, block, callbacks);
      wrapper.appendChild(contentBox);

      const isComplexVisualBlock =
        block.type === 'mermaid' ||
        block.type === 'mathBlock' ||
        block.type === 'table' ||
        block.type === 'code' ||
        block.type === 'carousel';

      // Mode 1: True In-Place Editing at Original Position (for heading, paragraph, alert, blockquote, list)
      const startTrueInPlaceEditing = (ev) => {
        if (wrapper.classList.contains('is-editing-inplace') || wrapper.classList.contains('is-editing')) {
          return;
        }
        wrapper.classList.add('is-editing-inplace');

        const currentSlice =
          callbacks && typeof callbacks.getBlockMarkdown === 'function'
            ? callbacks.getBlockMarkdown(block.startLine, block.endLine)
            : block.rawMarkdown || '';

        let hostEl = contentBox;
        let initialValue = currentSlice;
        let serializeValue = (val) => val;

        if (block.type === 'heading') {
          const hEl = contentBox.querySelector('.agy-heading');
          if (hEl) {
            hostEl = hEl;
          }
          initialValue = block.text || currentSlice.replace(/^\s*#{1,6}\s+/, '');
          const hashes = '#'.repeat(Math.min(6, Math.max(1, block.level || 1)));
          serializeValue = (val) => {
            const trimmed = val.replace(/\r?\n/g, ' ').trim();
            if (/^\s*#{1,6}\s+/.test(trimmed)) {
              return trimmed;
            }
            return `${hashes} ${trimmed}`;
          };
        } else if (block.type === 'alert') {
          const alertBody = contentBox.querySelector('.agy-alert-body');
          if (alertBody) {
            hostEl = alertBody;
          }
          initialValue = block.body || '';
          serializeValue = (val) => {
            const quotedBody = String(val || '')
              .split('\n')
              .map((lineStr) => `> ${lineStr}`)
              .join('\n');
            return `> [!${block.alertType}]\n${quotedBody}`;
          };
        } else if (block.type === 'blockquote') {
          const bqEl = contentBox.querySelector('.agy-blockquote');
          if (bqEl) {
            hostEl = bqEl;
          }
          initialValue = block.body || '';
          serializeValue = (val) =>
            String(val || '')
              .split('\n')
              .map((lineStr) => `> ${lineStr}`)
              .join('\n');
        } else if (block.type === 'paragraph') {
          const pEl = contentBox.querySelector('.agy-p');
          if (pEl) {
            hostEl = pEl;
          }
          initialValue = currentSlice;
        }

        // Calculate cursor position from mouse click position before hostEl DOM is replaced
        let targetCursorPos = -1;
        if (ev && typeof ev.clientX === 'number' && typeof document !== 'undefined') {
          try {
            let clickRange = null;
            if (document.caretRangeFromPoint) {
              clickRange = document.caretRangeFromPoint(ev.clientX, ev.clientY);
            } else if (document.caretPositionFromPoint) {
              const pos = document.caretPositionFromPoint(ev.clientX, ev.clientY);
              if (pos && pos.offsetNode) {
                clickRange = document.createRange();
                clickRange.setStart(pos.offsetNode, pos.offset);
                clickRange.collapse(true);
              }
            }
            if (clickRange && hostEl.contains(clickRange.startContainer)) {
              const preRange = document.createRange();
              preRange.selectNodeContents(hostEl);
              preRange.setEnd(clickRange.startContainer, clickRange.startOffset);
              const textBefore = preRange.toString();
              if (textBefore && initialValue.includes(textBefore)) {
                targetCursorPos = initialValue.indexOf(textBefore) + textBefore.length;
              } else if (textBefore) {
                const tail = textBefore.slice(-8);
                const subIdx = initialValue.indexOf(tail);
                targetCursorPos = subIdx !== -1 ? subIdx + tail.length : textBefore.length;
              } else {
                targetCursorPos = 0;
              }
            }
          } catch (_err) {
            targetCursorPos = -1;
          }
        }

        const inplaceInput = el('textarea', 'agy-inplace-editor', null, {
          rows: Math.max(1, initialValue.split('\n').length)
        });
        inplaceInput.value = initialValue;

        const autoFitHeight = () => {
          inplaceInput.style.height = 'auto';
          if (inplaceInput.scrollHeight > 0) {
            inplaceInput.style.height = `${inplaceInput.scrollHeight}px`;
          }
        };

        hostEl.replaceChildren(inplaceInput);
        autoFitHeight();
        inplaceInput.focus();

        if (targetCursorPos >= 0) {
          const safePos = Math.min(inplaceInput.value.length, Math.max(0, targetCursorPos));
          inplaceInput.setSelectionRange(safePos, safePos);
        } else {
          inplaceInput.setSelectionRange(inplaceInput.value.length, inplaceInput.value.length);
        }

        let activeStart = block.startLine;
        let activeEnd = block.endLine;
        let finished = false;

        inplaceInput.addEventListener('input', () => {
          autoFitHeight();
          const updatedMd = serializeValue(inplaceInput.value);
          if (callbacks && typeof callbacks.onBlockLiveEdit === 'function') {
            const newEnd = callbacks.onBlockLiveEdit(activeStart, activeEnd, updatedMd);
            if (typeof newEnd === 'number') {
              activeEnd = newEnd;
              block.endLine = newEnd;
              wrapper.setAttribute('data-end-line', String(activeEnd + 1));
            }
          }
        });

        const finishInPlace = () => {
          if (finished) return;
          finished = true;
          if (typeof document !== 'undefined' && document.removeEventListener) {
            document.removeEventListener('mousedown', onOutsideMouseDown, true);
          }
          wrapper.classList.remove('is-editing-inplace');
          const updatedMd = serializeValue(inplaceInput.value);
          block.rawMarkdown = updatedMd;
          contentBox.replaceChildren();
          const liveAst = parseMarkdownToAst(updatedMd);
          liveAst.blocks.forEach((b) => renderSingleBlockContent(contentBox, b, callbacks));
          if (callbacks && typeof callbacks.onBlockEditCommit === 'function') {
            callbacks.onBlockEditCommit(true);
          }
        };

        const onOutsideMouseDown = (e) => {
          if (!wrapper.contains(e.target)) {
            finishInPlace();
          }
        };

        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('mousedown', onOutsideMouseDown, true);
        }

        inplaceInput.addEventListener('blur', () => {
          setTimeout(() => {
            finishInPlace();
          }, 10);
        });

        inplaceInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
            e.preventDefault();
            e.stopPropagation();
            finishInPlace();
          }
        });
      };

      // Mode 2: Live Source + Live Preview Box Editing (for Mermaid, Math Block, Table, Code, Carousel)
      const startBoxLiveEditing = () => {
        if (wrapper.classList.contains('is-editing') || wrapper.classList.contains('is-editing-inplace')) {
          return;
        }
        wrapper.classList.add('is-editing');

        const editorBox = el('div', 'agy-inline-editor-box');
        const editorHeader = el('div', 'agy-inline-editor-header');
        editorHeader.appendChild(
          el('span', '', `实时编辑 (第 ${startLine1} - ${endLine1} 行 · 输入即实时渲染，点击编辑框外部自动保存)`)
        );
        const doneBtn = el('button', 'agy-block-btn', '✓ 完成');
        editorHeader.appendChild(doneBtn);

        const currentSlice =
          callbacks && typeof callbacks.getBlockMarkdown === 'function'
            ? callbacks.getBlockMarkdown(block.startLine, block.endLine)
            : block.rawMarkdown || '';

        const textarea = el('textarea', 'agy-inline-editor-input');
        textarea.value = currentSlice;
        const lineCount = Math.max(3, currentSlice.split('\n').length + 1);
        textarea.rows = Math.min(18, lineCount);

        editorBox.appendChild(editorHeader);
        editorBox.appendChild(textarea);
        wrapper.insertBefore(editorBox, contentBox);
        textarea.focus();

        let activeStart = block.startLine;
        let activeEnd = block.endLine;
        let finished = false;

        // Live render & sync on every keystroke!
        textarea.addEventListener('input', () => {
          const updatedMd = textarea.value;
          contentBox.replaceChildren();
          const liveAst = parseMarkdownToAst(updatedMd);
          liveAst.blocks.forEach((b) => renderSingleBlockContent(contentBox, b, callbacks));

          if (callbacks && typeof callbacks.onBlockLiveEdit === 'function') {
            const newEnd = callbacks.onBlockLiveEdit(activeStart, activeEnd, updatedMd);
            if (typeof newEnd === 'number') {
              activeEnd = newEnd;
              wrapper.setAttribute('data-end-line', String(activeEnd + 1));
            }
          }
        });

        const finishEditing = () => {
          if (finished || !wrapper.classList.contains('is-editing')) return;
          finished = true;
          if (typeof document !== 'undefined' && document.removeEventListener) {
            document.removeEventListener('mousedown', onOutsideMouseDown, true);
          }
          wrapper.classList.remove('is-editing');
          editorBox.remove();
          if (callbacks && typeof callbacks.onBlockEditCommit === 'function') {
            callbacks.onBlockEditCommit(true);
          }
        };

        const onOutsideMouseDown = (e) => {
          if (!wrapper.contains(e.target)) {
            finishEditing();
          }
        };

        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('mousedown', onOutsideMouseDown, true);
        }

        textarea.addEventListener('blur', (e) => {
          setTimeout(() => {
            if (e && e.relatedTarget && wrapper.contains(e.relatedTarget)) {
              return;
            }
            finishEditing();
          }, 20);
        });

        doneBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          finishEditing();
        });

        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
            e.preventDefault();
            e.stopPropagation();
            finishEditing();
          }
        });
      };

      const startInPlaceEditing = (ev) => {
        if (isComplexVisualBlock) {
          startBoxLiveEditing();
        } else {
          startTrueInPlaceEditing(ev);
        }
      };

      editBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        startInPlaceEditing(null);
      });

      chatBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (callbacks && typeof callbacks.onAddRangeToChat === 'function') {
          callbacks.onAddRangeToChat(startLine1, endLine1, block.rawMarkdown || '');
        }
      });

      // Regular blocks require double click to edit in place, positioning cursor directly at click
      wrapper.addEventListener('dblclick', (ev) => {
        if (wrapper.classList.contains('is-editing') || wrapper.classList.contains('is-editing-inplace')) return;
        const targetTag = (ev.target && ev.target.tagName ? ev.target.tagName : '').toLowerCase();
        if (targetTag === 'a' || targetTag === 'button' || targetTag === 'input' || targetTag === 'textarea') {
          return;
        }
        ev.stopPropagation();
        startInPlaceEditing(ev);
      });

      container.appendChild(wrapper);
      const nextInsertLine = block.endLine !== undefined ? block.endLine + 1 : (block.startLine || 0) + 1;
      container.appendChild(createInsertDivider(nextInsertLine, callbacks, container));
    }

    // Render any trailing diff hunks that occur after all document blocks
    trailingHunks.forEach((hunk) => {
      container.appendChild(createDiffHunkBanner(hunk, callbacks));
      if (hunk.removedCount > 0 && hunk.deletedTexts && hunk.deletedTexts.length > 0) {
        container.appendChild(createDiffDeletedContainer(hunk));
      }
    });

    if (blocks.length === 0) {
      container.appendChild(createInsertDivider(0, callbacks, container));
    }
  }

  /**
   * Initialize the interactive Antigravity Artifact Viewer UI inside the VS Code Webview.
   */
  function initWebviewApp() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const root = document.getElementById('app-root');
    if (!root) {
      return;
    }

    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

    const state = {
      text: '',
      fileName: 'Document.md',
      filePath: '',
      baseWebviewUri: '',
      isDirty: false,
      isBrainArtifact: false,
      viewMode: 'preview',
      showOutline: true,
      aiCompanionEnabled: false,
      initializedConfig: false,
      diff: null
    };

    // Build Top Header Bar (only AI platform toggles + outline toggle)
    const topbar = el('header', 'agy-topbar');
    const dirtyDot = el('span', 'agy-dirty-dot', null, { title: '有未保存的更改 (Ctrl+S 保存)' });
    dirtyDot.style.display = 'none';

    const topRight = el('div', 'agy-topbar-right');

    // AI platform toggles (top menu): choose which platforms appear in the floating capsule
    const AI_PLATFORMS = [
      { id: 'vscode', icon: '💬', label: 'VS Code' },
      { id: 'antigravity', icon: '✦', label: 'Antigravity' },
      { id: 'claude', icon: '✴', label: 'Claude Code' },
      { id: 'codex', icon: '◎', label: 'Codex' }
    ];
    state.enabledAiPlatforms = AI_PLATFORMS.map((p) => p.id);
    const aiPlatformGroup = el('div', 'agy-ai-platform-group', null, {
      title: '选择启用的 AI 平台（选中文本后，悬浮胶囊中仅显示已启用的平台）'
    });
    aiPlatformGroup.appendChild(el('span', 'agy-ai-platform-label', 'AI 平台'));
    const aiPlatformButtons = {};
    AI_PLATFORMS.forEach((p) => {
      const b = el('button', 'agy-ai-platform-btn active', p.label, { 'data-platform': p.id });
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const set = new Set(state.enabledAiPlatforms);
        if (set.has(p.id)) {
          set.delete(p.id);
        } else {
          set.add(p.id);
        }
        state.enabledAiPlatforms = AI_PLATFORMS.map((x) => x.id).filter((id) => set.has(id));
        refreshAiPlatformUi();
        if (vscode) {
          vscode.postMessage({ type: 'updateAiPlatforms', platforms: state.enabledAiPlatforms });
        }
      });
      aiPlatformButtons[p.id] = b;
      aiPlatformGroup.appendChild(b);
    });

    const btnOutline = el('button', 'agy-action-btn', '☰ 目录大纲');
    topRight.appendChild(dirtyDot);
    topRight.appendChild(aiPlatformGroup);
    topRight.appendChild(btnOutline);

    topbar.appendChild(topRight);

    // Main Workspace Container
    const workspace = el('div', 'agy-workspace');

    // Outline Sidebar
    const outlineAside = el('aside', 'agy-outline');
    const outlineHeader = el('div', 'agy-outline-header');
    outlineHeader.appendChild(el('span', '', '大纲导航 (Outline)'));
    const outlineCount = el('span', '', '0');
    outlineHeader.appendChild(outlineCount);
    const outlineList = el('div', 'agy-outline-list');
    outlineAside.appendChild(outlineHeader);
    outlineAside.appendChild(outlineList);

    // Source Editor Pane
    const editorPane = el('div', 'agy-editor-pane hidden');
    const sourceTextarea = el('textarea', 'agy-source-textarea', '', {
      placeholder: '在此编写 Markdown 内容，右侧将实时渲染 Antigravity Artifact 视图...'
    });
    editorPane.appendChild(sourceTextarea);

    // Preview Pane
    const previewPane = el('main', 'agy-preview-pane');
    const diffStickyBar = el('div', 'agy-diff-sticky-bar');
    diffStickyBar.style.display = 'none';
    const docContainer = el('article', 'agy-document');
    previewPane.appendChild(diffStickyBar);
    previewPane.appendChild(docContainer);

    workspace.appendChild(outlineAside);
    workspace.appendChild(editorPane);
    workspace.appendChild(previewPane);

    // Floating Selection AI Capsule (enabled platforms shown unfolded side-by-side)
    const selectionBar = el('div', 'agy-selection-bar hidden');
    const selRangeBadge = el('span', 'agy-selection-range-badge', 'L1-1');
    const selPlatformWrap = el('span', 'agy-selection-platforms');
    selPlatformWrap.style.display = 'inline-flex';
    selPlatformWrap.style.gap = '5px';
    selPlatformWrap.style.flexWrap = 'wrap';
    selectionBar.appendChild(selRangeBadge);
    selectionBar.appendChild(selPlatformWrap);

    root.replaceChildren(topbar, workspace, selectionBar);

    function applyViewMode(mode) {
      state.viewMode = mode;
      editorPane.classList.toggle('hidden', mode === 'preview');
      previewPane.classList.toggle('hidden', mode === 'source');
    }

    function applyOutlineVisibility(visible) {
      state.showOutline = visible;
      outlineAside.classList.toggle('hidden', !visible);
    }

    btnOutline.addEventListener('click', () => applyOutlineVisibility(!state.showOutline));

    /**
     * Send a line range to one specific AI platform.
     * @param {string} platform
     * @param {{startLineNumber:number,endLineNumber:number,selectedText:string}} range
     */
    function sendRangeToPlatform(platform, range) {
      if (!vscode) return;
      vscode.postMessage({
        type: 'sendSelectionToPlatform',
        platform,
        startLineNumber: range.startLineNumber,
        endLineNumber: range.endLineNumber,
        selectedText: range.selectedText
      });
    }

    function refreshAiPlatformUi() {
      const enabled = new Set(state.enabledAiPlatforms);
      AI_PLATFORMS.forEach((p) => {
        aiPlatformButtons[p.id].classList.toggle('active', enabled.has(p.id));
      });
      selPlatformWrap.replaceChildren();
      AI_PLATFORMS.filter((p) => enabled.has(p.id)).forEach((p) => {
        const b = el('button', 'agy-selection-pill-btn', `${p.icon} ${p.label}`, {
          title: `仅发送到 ${p.label} 聊天框`
        });
        b.addEventListener('mousedown', (ev) => ev.preventDefault());
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          sendRangeToPlatform(p.id, lastSelectionRange);
          selectionBar.classList.add('hidden');
          root.classList.remove('has-selection-capsule');
        });
        selPlatformWrap.appendChild(b);
      });
      if (enabled.size === 0) {
        selPlatformWrap.appendChild(el('span', 'agy-ai-platform-label', '未启用 AI 平台（顶部菜单开启）'));
      }
    }
    refreshAiPlatformUi();

    /**
     * Accurately resolve 1-based [startLineNumber, endLineNumber] from DOM selection or textarea selection.
     * @returns {{ startLineNumber: number, endLineNumber: number, selectedText: string }}
     */
    function resolveDomSelectionLineRange() {
      if (document.activeElement === sourceTextarea) {
        const startOffset = sourceTextarea.selectionStart || 0;
        const endOffset = Math.max(startOffset, sourceTextarea.selectionEnd || startOffset);
        const startLineNumber = state.text.slice(0, startOffset).split('\n').length;
        const endLineNumber = state.text.slice(0, endOffset).split('\n').length;
        return {
          startLineNumber,
          endLineNumber,
          selectedText: sourceTextarea.value.slice(startOffset, endOffset)
        };
      }

      const sel = window.getSelection ? window.getSelection() : null;
      const selectedText = sel ? String(sel).trim() : '';

      const findClosestLineAttr = (node) => {
        let cur = node && node.nodeType === 3 ? node.parentElement : node;
        while (cur && cur !== docContainer) {
          if (cur.getAttribute) {
            const exactLine = cur.getAttribute('data-line');
            if (exactLine) {
              const n = parseInt(exactLine, 10);
              return { start: n, end: n };
            }
            const bStart = cur.getAttribute('data-start-line');
            const bEnd = cur.getAttribute('data-end-line');
            if (bStart) {
              return {
                start: parseInt(bStart, 10),
                end: bEnd ? parseInt(bEnd, 10) : parseInt(bStart, 10)
              };
            }
          }
          cur = cur.parentElement;
        }
        return null;
      };

      if (sel && sel.rangeCount > 0) {
        const anchorInfo = findClosestLineAttr(sel.anchorNode);
        const focusInfo = findClosestLineAttr(sel.focusNode);
        if (anchorInfo || focusInfo) {
          const aStart = anchorInfo ? anchorInfo.start : focusInfo.start;
          const aEnd = anchorInfo ? anchorInfo.end : focusInfo.end;
          const fStart = focusInfo ? focusInfo.start : aStart;
          const fEnd = focusInfo ? focusInfo.end : aEnd;
          let startLineNumber = Math.min(aStart, fStart);
          let endLineNumber = Math.max(aEnd, fEnd);

          // Refine within block if selectedText matches a specific sub-range of lines
          if (selectedText) {
            const docLines = state.text.split('\n');
            const blockSlice = docLines.slice(Math.max(0, startLineNumber - 1), endLineNumber).join('\n');
            const subIdx = blockSlice.indexOf(selectedText);
            if (subIdx !== -1) {
              const offsetLines = blockSlice.slice(0, subIdx).split('\n').length - 1;
              const spanLines = selectedText.split('\n').length;
              startLineNumber = startLineNumber + offsetLines;
              endLineNumber = startLineNumber + spanLines - 1;
            }
          }

          return { startLineNumber, endLineNumber, selectedText };
        }
      }

      if (selectedText) {
        const idx = state.text.indexOf(selectedText);
        if (idx !== -1) {
          const startLineNumber = state.text.slice(0, idx).split('\n').length;
          const endLineNumber = startLineNumber + selectedText.split('\n').length - 1;
          return { startLineNumber, endLineNumber, selectedText };
        }
      }

      return { startLineNumber: 1, endLineNumber: 1, selectedText };
    }

    let lastSelectionRange = { startLineNumber: 1, endLineNumber: 1, selectedText: '' };

    const hideSelectionCapsule = () => {
      selectionBar.classList.add('hidden');
      root.classList.remove('has-selection-capsule');
    };

    document.addEventListener('mousedown', (ev) => {
      if (!selectionBar.contains(ev.target)) {
        hideSelectionCapsule();
      }
    });

    previewPane.addEventListener('scroll', () => {
      hideSelectionCapsule();
    });

    // Detect text selection in Preview: only show the floating AI capsule (never opens any text editor)
    document.addEventListener('mouseup', (ev) => {
      if (selectionBar.contains(ev.target)) {
        return;
      }
      setTimeout(() => {
        const sel = window.getSelection ? window.getSelection() : null;
        const selText = sel ? String(sel).trim() : '';
        if (!selText || (document.activeElement && document.activeElement.tagName === 'TEXTAREA')) {
          hideSelectionCapsule();
          return;
        }

        const info = resolveDomSelectionLineRange();
        lastSelectionRange = info;
        selRangeBadge.textContent = `L${info.startLineNumber}-${info.endLineNumber}`;
        refreshAiPlatformUi();

        selectionBar.classList.remove('hidden');
        root.classList.add('has-selection-capsule');
        const barWidth = selectionBar.offsetWidth || 380;
        const barHeight = selectionBar.offsetHeight || 36;

        let rect = null;
        if (sel && sel.rangeCount > 0) {
          try {
            const r = sel.getRangeAt(0).getBoundingClientRect();
            if (r && (r.width > 0 || r.height > 0)) {
              rect = r;
            }
          } catch (_err) {
            rect = null;
          }
        }

        let x = ev.clientX - 40;
        let y = ev.clientY - barHeight - 14;
        if (rect) {
          // If there is ample empty space to the right of the selection on the same row, place it to the right
          if (window.innerWidth - rect.right >= barWidth + 24) {
            x = rect.right + 12;
            y = Math.max(52, rect.top + (rect.height - barHeight) / 2);
          } else {
            x = rect.right - barWidth / 2;
            if (rect.top - barHeight - 12 >= 52) {
              y = rect.top - barHeight - 12;
            } else {
              y = rect.bottom + 12;
            }
          }
        }
        x = Math.min(window.innerWidth - barWidth - 12, Math.max(12, x));
        y = Math.min(window.innerHeight - barHeight - 12, Math.max(52, y));
        selectionBar.style.left = `${Math.round(x)}px`;
        selectionBar.style.top = `${Math.round(y)}px`;
      }, 20);
    });

    // Live editing in Split / Source mode
    let editTimer = null;
    function pushTextEditToExtension(newText, autoSave) {
      state.text = newText;
      if (document.activeElement !== sourceTextarea) {
        sourceTextarea.value = newText;
      }
      if (editTimer) {
        clearTimeout(editTimer);
        editTimer = null;
      }
      if (autoSave) {
        if (vscode) {
          vscode.postMessage({ type: 'edit', text: state.text, autoSave: true });
        }
        return;
      }
      editTimer = setTimeout(() => {
        editTimer = null;
        if (vscode) {
          vscode.postMessage({ type: 'edit', text: state.text });
        }
      }, 120);
    }

    sourceTextarea.addEventListener('input', () => {
      state.text = sourceTextarea.value;
      renderDocument();
      pushTextEditToExtension(sourceTextarea.value);
    });

    // Keyboard shortcuts: Ctrl+S (save), Ctrl+L or Alt+K (send selection to Copilot / Claude / Antigravity Chat)
    window.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        if (vscode) {
          vscode.postMessage({ type: 'save' });
        }
      } else if (
        ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'l') ||
        (ev.altKey && ev.key.toLowerCase() === 'k')
      ) {
        ev.preventDefault();
        if (vscode) {
          const info = resolveDomSelectionLineRange();
          // Ctrl+L sends to the first enabled platform (current preferred platform)
          const preferred = state.enabledAiPlatforms[0] || '';
          sendRangeToPlatform(preferred, info);
        }
      }
    });

    const callbacks = {
      get baseWebviewUri() {
        return state.baseWebviewUri;
      },
      get diff() {
        return state.diff;
      },
      getBlockMarkdown(startLine, endLine) {
        const lines = state.text.replace(/\r\n/g, '\n').split('\n');
        return lines.slice(startLine, endLine + 1).join('\n');
      },
      onBlockLiveEdit(startLine, endLine, newBlockMarkdown) {
        const lines = state.text.replace(/\r\n/g, '\n').split('\n');
        const replacementLines = newBlockMarkdown.replace(/\r\n/g, '\n').split('\n');
        lines.splice(startLine, endLine - startLine + 1, ...replacementLines);
        pushTextEditToExtension(lines.join('\n'));
        return startLine + replacementLines.length - 1;
      },
      onBlockEditCommit(autoSave) {
        if (autoSave) {
          pushTextEditToExtension(state.text, true);
        }
        renderDocument();
      },
      onAcceptAllDiff() {
        if (vscode) {
          vscode.postMessage({ type: 'acceptAllDiff' });
        }
      },
      onRejectAllDiff() {
        if (vscode) {
          vscode.postMessage({ type: 'rejectAllDiff' });
        }
      },
      onAcceptHunk(hunk) {
        if (vscode) {
          vscode.postMessage({ type: 'acceptDiffHunk', hunk });
        }
      },
      onRejectHunk(hunk) {
        if (vscode) {
          vscode.postMessage({ type: 'rejectDiffHunk', hunk });
        }
      },
      onAddRangeToChat(startLineNumber, endLineNumber, snippetText) {
        const preferred = state.enabledAiPlatforms[0] || '';
        sendRangeToPlatform(preferred, { startLineNumber, endLineNumber, selectedText: snippetText });
      },
      onOpenFileLink(href) {
        if (vscode) {
          vscode.postMessage({ type: 'openFileLink', href });
        }
      },
      onOpenExternalLink(href) {
        if (vscode) {
          vscode.postMessage({ type: 'openExternalLink', href });
        }
      },
      onToggleTaskItem(lineIndex) {
        if (vscode) {
          vscode.postMessage({ type: 'toggleTaskItem', line: lineIndex });
        }
      },
      onCopyText(text) {
        if (vscode) {
          vscode.postMessage({ type: 'copyText', text });
        }
      },
      onInsertMarkdownBlock(lineIndex, newMarkdown) {
        const lines = state.text.replace(/\r\n/g, '\n').split('\n');
        const cleanNew = newMarkdown.replace(/\r\n/g, '\n').split('\n');
        const target = Math.min(lines.length, Math.max(0, lineIndex));
        lines.splice(target, 0, '', ...cleanNew);
        pushTextEditToExtension(lines.join('\n'), true);
        renderDocument();
      }
    };

    function renderDocument() {
      dirtyDot.style.display = state.isDirty ? 'inline-block' : 'none';
      updateDiffStickyBar(diffStickyBar, state.diff, callbacks);

      const ast = parseMarkdownToAst(state.text);

      // Update TOC Outline
      outlineCount.textContent = String(ast.headings.length);
      outlineList.replaceChildren();
      ast.headings.forEach((h) => {
        const item = el(
          'button',
          `agy-outline-item level-${Math.min(4, h.level)}`,
          h.text.replace(/[`*_~]/g, '')
        );
        item.addEventListener('click', () => {
          const target = document.getElementById(h.id);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        outlineList.appendChild(item);
      });

      // Render Document Body
      docContainer.replaceChildren();
      if (ast.frontmatter.length > 0) {
        const fmCard = el('div', 'agy-frontmatter');
        ast.frontmatter.forEach((pair) => {
          fmCard.appendChild(el('span', 'agy-frontmatter-key', pair.key));
          fmCard.appendChild(el('span', 'agy-frontmatter-val', pair.value));
        });
        docContainer.appendChild(fmCard);
      }

      renderBlocksIntoDom(docContainer, ast.blocks, callbacks);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type !== 'documentUpdate') {
        return;
      }

      if (msg.config && Array.isArray(msg.config.enabledAiPlatforms)) {
        state.enabledAiPlatforms = AI_PLATFORMS.map((p) => p.id).filter((id) =>
          msg.config.enabledAiPlatforms.includes(id)
        );
        refreshAiPlatformUi();
      }

      // Avoid overwriting an active inline block editor while the user is typing in it
      const activeInlineEditor = document.querySelector(
        '.agy-editable-block.is-editing, .agy-editable-block.is-editing-inplace'
      );
      if (activeInlineEditor && msg.text === state.text) {
        state.isDirty = Boolean(msg.isDirty);
        dirtyDot.style.display = state.isDirty ? 'inline-block' : 'none';
        return;
      }

      state.text = msg.text || '';
      state.diff = msg.diff || null;
      state.fileName = msg.fileName || 'Document.md';
      state.filePath = msg.filePath || '';
      state.baseWebviewUri = msg.baseWebviewUri || '';
      state.isDirty = Boolean(msg.isDirty);
      state.isBrainArtifact = Boolean(msg.isBrainArtifact);

      if (!state.initializedConfig && msg.config) {
        state.initializedConfig = true;
        applyViewMode('preview');
        applyOutlineVisibility(msg.config.showOutline !== false);
      }

      if (document.activeElement !== sourceTextarea) {
        sourceTextarea.value = state.text;
      }

      if (!activeInlineEditor) {
        renderDocument();
      }
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        if (ev.key === 'Enter') {
          if (state.diff && state.diff.hasDiff) {
            ev.preventDefault();
            callbacks.onAcceptAllDiff();
          }
        } else if (ev.key === 'Backspace' && ev.shiftKey) {
          if (state.diff && state.diff.hasDiff) {
            ev.preventDefault();
            callbacks.onRejectAllDiff();
          }
        } else if (ev.key.toLowerCase() === 'j') {
          const hunks = document.querySelectorAll('.agy-diff-hunk-banner');
          if (hunks.length > 0) {
            ev.preventDefault();
            const next =
              Array.from(hunks).find((h) => h.getBoundingClientRect().top > window.innerHeight * 0.35) || hunks[0];
            next.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else if (ev.key.toLowerCase() === 'k') {
          const hunks = document.querySelectorAll('.agy-diff-hunk-banner');
          if (hunks.length > 0) {
            ev.preventDefault();
            const reversed = Array.from(hunks).reverse();
            const prev =
              reversed.find((h) => h.getBoundingClientRect().top < window.innerHeight * 0.25) ||
              hunks[hunks.length - 1];
            prev.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    });

    if (vscode) {
      vscode.postMessage({ type: 'ready' });
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    initWebviewApp();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseMarkdownToAst,
      renderMermaidSvg,
      renderMathDom,
      readLatexArgument,
      appendInlineNodes,
      renderBlocksIntoDom,
      createDiffHunkBanner,
      createDiffDeletedContainer
    };
  }
})();
