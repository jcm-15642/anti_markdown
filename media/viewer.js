(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Helper to create an HTML element with class, text, and attributes using safe DOM APIs.
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @param {Record<string, string>} [attrs]
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
   * Helper to create an SVG element safely via createElementNS.
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
   * Parse Markdown text (including 4-backtick fences, YAML frontmatter, alerts, tables,
   * carousels, display math, and lists) into a structured AST.
   * @param {string} rawMarkdown
   * @returns {{ frontmatter: Array<{key: string, value: string}>, blocks: Array<any>, headings: Array<any> }}
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

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip blank lines
      if (!trimmed) {
        i++;
        continue;
      }

      // 2. Fenced Code Block / Carousel / Mermaid (supports 3 or more backticks or tildes)
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

        const codeContent = contentLines.join('\n');
        if (lang === 'carousel') {
          const slides = codeContent
            .split(/<!--\s*slide\s*-->/i)
            .map((s) => s.trim())
            .filter(Boolean);
          blocks.push({
            type: 'carousel',
            slides,
            startLine
          });
        } else if (lang === 'mermaid') {
          blocks.push({
            type: 'mermaid',
            code: codeContent,
            startLine
          });
        } else if (lang === 'math' || lang === 'latex' || lang === 'katex') {
          blocks.push({
            type: 'mathBlock',
            expression: codeContent,
            startLine
          });
        } else {
          blocks.push({
            type: 'code',
            lang: lang || 'text',
            meta,
            code: codeContent,
            startLine
          });
        }
        continue;
      }

      // 3. Display Math Block $$ ... $$ or \[ ... \]
      if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
        const isDollar = trimmed.startsWith('$$');
        const closeToken = isDollar ? '$$' : '\\]';
        const firstLineRest = trimmed.slice(2).trim();

        if (firstLineRest.endsWith(closeToken) && firstLineRest.length > closeToken.length) {
          blocks.push({
            type: 'mathBlock',
            expression: firstLineRest.slice(0, -closeToken.length).trim(),
            startLine: i
          });
          i++;
          continue;
        }

        const exprLines = [];
        if (firstLineRest && firstLineRest !== closeToken) {
          exprLines.push(firstLineRest);
        }
        const startLine = i;
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
        blocks.push({
          type: 'mathBlock',
          expression: exprLines.join('\n').trim(),
          startLine
        });
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
          id,
          startLine: i
        };
        headings.push(headingObj);
        blocks.push(headingObj);
        i++;
        continue;
      }

      // 5. Horizontal Rule
      if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
        blocks.push({ type: 'hr', startLine: i });
        i++;
        continue;
      }

      // 6. Blockquote or GitHub-style Alert (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
      if (/^\s*>/.test(line)) {
        const quoteLines = [];
        const startLine = i;
        while (i < lines.length && (/^\s*>/.test(lines[i]) || (lines[i].trim() !== '' && quoteLines.length > 0 && !/^\s*(?:#|`{3,}|[-*+]\s|\d+\.\s|\|)/.test(lines[i])))) {
          if (/^\s*>/.test(lines[i])) {
            quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          } else {
            quoteLines.push(lines[i]);
          }
          i++;
        }

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
          blocks.push({
            type: 'alert',
            alertType,
            title: alertType,
            body: bodyLines.join('\n').trim(),
            startLine
          });
        } else {
          blocks.push({
            type: 'blockquote',
            body: quoteLines.join('\n').trim(),
            startLine
          });
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

        blocks.push({
          type: 'table',
          headers,
          alignments,
          rows,
          startLine
        });
        continue;
      }

      // 8. Ordered or Unordered List (with nested items & Task List checkboxes)
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        const ordered = /^\d+\.$/.test(listMatch[2]);
        const items = [];
        const startLine = i;

        while (i < lines.length) {
          const itemLine = lines[i];
          if (!itemLine.trim()) {
            // Check if next non-empty line continues the list
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

        blocks.push({
          type: 'list',
          ordered,
          items,
          startLine
        });
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
          (nextLine.includes('|') &&
            i + 1 < lines.length &&
            /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1]))
        ) {
          break;
        }
        paraLines.push(nextLine);
        i++;
      }

      blocks.push({
        type: 'paragraph',
        text: paraLines.join('\n'),
        startLine
      });
    }

    return { frontmatter, blocks, headings };
  }

  /**
   * Format a LaTeX math expression into rich DOM nodes (symbols, fractions, super/subscripts).
   * @param {string} expr
   * @param {boolean} isBlock
   * @returns {HTMLElement}
   */
  function renderMathDom(expr, isBlock) {
    const container = el(isBlock ? 'div' : 'span', isBlock ? 'agy-math-block' : 'agy-math-inline');

    const symbolMap = {
      '\\alpha': 'α',
      '\\beta': 'β',
      '\\gamma': 'γ',
      '\\delta': 'δ',
      '\\epsilon': 'ε',
      '\\theta': 'θ',
      '\\lambda': 'λ',
      '\\mu': 'μ',
      '\\pi': 'π',
      '\\sigma': 'σ',
      '\\omega': 'ω',
      '\\Delta': 'Δ',
      '\\Sigma': 'Σ',
      '\\Omega': 'Ω',
      '\\sum': '∑',
      '\\prod': '∏',
      '\\int': '∫',
      '\\infty': '∞',
      '\\approx': '≈',
      '\\neq': '≠',
      '\\leq': '≤',
      '\\le': '≤',
      '\\geq': '≥',
      '\\ge': '≥',
      '\\times': '×',
      '\\cdot': '·',
      '\\pm': '±',
      '\\to': '→',
      '\\rightarrow': '→',
      '\\leftarrow': '←',
      '\\Rightarrow': '⇒',
      '\\iff': '⇔',
      '\\in': '∈',
      '\\notin': '∉',
      '\\subset': '⊂',
      '\\subseteq': '⊆',
      '\\cup': '∪',
      '\\cap': '∩',
      '\\forall': '∀',
      '\\exists': '∃',
      '\\partial': '∂',
      '\\nabla': '∇'
    };

    let text = String(expr || '').trim();
    const symKeys = Object.keys(symbolMap);
    for (let i = 0; i < symKeys.length; i++) {
      const k = symKeys[i];
      text = text.split(k).join(symbolMap[k]);
    }

    // Parse \frac{a}{b}, ^{sup}, _{sub}, \sqrt{x}, \text{...}
    const tokenRegex = /\\frac\{([^{}]*)\}\{([^{}]*)\}|\\sqrt\{([^{}]*)\}|\\text\{([^{}]*)\}|\^(\{[^{}]*\}|[A-Za-z0-9+-])|_(\{[^{}]*\}|[A-Za-z0-9+-])/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      if (match[1] !== undefined && match[2] !== undefined) {
        const frac = el('span', 'agy-math-frac');
        frac.appendChild(el('span', 'agy-math-frac-num', match[1]));
        frac.appendChild(el('span', 'agy-math-frac-den', match[2]));
        container.appendChild(frac);
      } else if (match[3] !== undefined) {
        const sqrt = el('span', '', '√(' + match[3] + ')');
        container.appendChild(sqrt);
      } else if (match[4] !== undefined) {
        container.appendChild(el('span', '', match[4]));
      } else if (match[5] !== undefined) {
        const supVal = match[5].replace(/^\{|\}$/g, '');
        container.appendChild(el('sup', '', supVal));
      } else if (match[6] !== undefined) {
        const subVal = match[6].replace(/^\{|\}$/g, '');
        container.appendChild(el('sub', '', subVal));
      }
      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

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

    const pattern = /(!\[([^\]]*)\]\(([^)]+)\))|(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\$\$([^$]+)\$\$|\$([^$\n]+)\$)|(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*\n]+)\*|_([^_\n]+)_)|(~~([^~]+)~~)|(<br\s*\/?>)/gi;

    let lastIdx = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parent.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      }

      if (match[1]) {
        // Image ![alt](src)
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
        // Link [label](href) — check if it is a file:// or local code reference pill
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
            if (callbacks && typeof callbacks.onOpenFileLink === 'function') {
              callbacks.onOpenFileLink(rawHref);
            }
          });
          parent.appendChild(pill);
        } else if (rawHref.startsWith('#')) {
          const anchor = el('a', 'agy-link', rawLabel, { href: rawHref });
          anchor.addEventListener('click', (ev) => {
            ev.preventDefault();
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
            if (callbacks && typeof callbacks.onOpenExternalLink === 'function') {
              callbacks.onOpenExternalLink(rawHref);
            }
          });
          parent.appendChild(link);
        }
      } else if (match[7]) {
        // Inline code `code`
        parent.appendChild(el('code', 'agy-inline-code', match[8]));
      } else if (match[9]) {
        // Inline math $...$
        const expr = match[10] || match[11] || '';
        parent.appendChild(renderMathDom(expr, false));
      } else if (match[12]) {
        // Bold **...**
        const strong = el('strong');
        appendInlineNodes(strong, match[13] || match[14], callbacks);
        parent.appendChild(strong);
      } else if (match[15]) {
        // Italic *...*
        const em = el('em');
        appendInlineNodes(em, match[16] || match[17], callbacks);
        parent.appendChild(em);
      } else if (match[18]) {
        // Strikethrough ~~...~~
        const del = el('del');
        appendInlineNodes(del, match[19], callbacks);
        parent.appendChild(del);
      } else if (match[20]) {
        // <br>
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
   * Parse and render Mermaid diagrams (flowchart/graph, erDiagram, sequenceDiagram,
   * stateDiagram, classDiagram, xychart-beta) into interactive SVG elements using createElementNS.
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
      diagramType: /^stateDiagram/i.test(firstLine) ? 'State Diagram' : 'Flowchart',
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

    function cleanLabel(lbl) {
      return String(lbl)
        .replace(/^["']|["']$/g, '')
        .split(/<br\s*\/?>|\\n/i)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    function parseNodeToken(token) {
      const t = token.trim();
      if (!t) return null;
      if (t === '[*]') {
        return ensureNode('__start_end__', '●', 'circle');
      }

      // Match shapes: ID[(Cylinder)], ID([Stadium]), ID((Circle)), ID{Diamond}, ID(Round), ID[Rect]
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

      // Parse style directive: style NodeID fill:#1e3a5f,stroke:#60a5fa,color:#fff
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

      // Parse subgraph
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

      // Split chained edges on a line: A -->|label| B <--> C
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

    // Compute topological layers (ranks) for layout
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
          if ((currRank + 1) < nodeList.length) {
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

    // Measure each node box
    nodeList.forEach((n) => {
      let maxChars = 6;
      n.label.forEach((lineStr) => {
        let len = 0;
        for (let c = 0; c < lineStr.length; c++) {
          len += lineStr.charCodeAt(c) > 255 ? 1.85 : 1;
        }
        if (len > maxChars) maxChars = len;
      });
      n.width = Math.max(120, Math.min(280, Math.round(maxChars * 8.5 + 34)));
      n.height = Math.max(46, n.label.length * 20 + 24);
      if (n.shape === 'diamond') {
        n.width += 28;
        n.height += 18;
      }
    });

    const layerGapX = isHorizontal ? 220 : 190;
    const layerGapY = isHorizontal ? 105 : 115;
    const padX = 48;
    const padY = 48;

    let maxCanvasX = 400;
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

    // Arrowhead markers
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

    // Render Subgraph bounding boxes
    subgraphs.forEach((sg) => {
      const sgNodes = sg.nodeIds.map((id) => nodes.get(id)).filter(Boolean);
      if (sgNodes.length === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      sgNodes.forEach((n) => {
        minX = Math.min(minX, n.cx - n.width / 2 - 18);
        minY = Math.min(minY, n.cy - n.height / 2 - 28);
        maxX = Math.max(maxX, n.cx + n.width / 2 + 18);
        maxY = Math.max(maxY, n.cy + n.height / 2 + 16);
      });
      svg.appendChild(
        svgEl('rect', {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          rx: 10,
          fill: 'rgba(96, 165, 250, 0.05)',
          stroke: 'rgba(148, 163, 184, 0.35)',
          'stroke-dasharray': '5,4'
        })
      );
      svg.appendChild(
        svgEl(
          'text',
          {
            x: minX + 12,
            y: minY + 18,
            fill: '#94a3b8',
            'font-size': '11.5',
            'font-weight': '600'
          },
          sg.title
        )
      );
    });

    // Render Edges
    edges.forEach((e) => {
      const fromNode = nodes.get(e.from);
      const toNode = nodes.get(e.to);
      if (!fromNode || !toNode) return;

      const dx = toNode.cx - fromNode.cx;
      const dy = toNode.cy - fromNode.cy;
      let x1 = fromNode.cx;
      let y1 = fromNode.cy;
      let x2 = toNode.cx;
      let y2 = toNode.cy;

      if (Math.abs(dx) > Math.abs(dy)) {
        x1 += dx > 0 ? fromNode.width / 2 : -fromNode.width / 2;
        x2 -= dx > 0 ? toNode.width / 2 + 4 : -(toNode.width / 2 + 4);
      } else {
        y1 += dy > 0 ? fromNode.height / 2 : -fromNode.height / 2;
        y2 -= dy > 0 ? toNode.height / 2 + 4 : -(toNode.height / 2 + 4);
      }

      const cx1 = (x1 + x2) / 2;
      const cy1 = y1;
      const cx2 = (x1 + x2) / 2;
      const cy2 = y2;
      const pathAttrs = {
        d: `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`,
        fill: 'none',
        stroke: '#60a5fa',
        'stroke-width': '1.75',
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
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 6;
        const lblWidth = e.label.length * 7.5 + 14;
        svg.appendChild(
          svgEl('rect', {
            x: mx - lblWidth / 2,
            y: my - 11,
            width: lblWidth,
            height: 18,
            rx: 4,
            fill: '#18181b',
            stroke: 'rgba(96, 165, 250, 0.35)'
          })
        );
        svg.appendChild(
          svgEl(
            'text',
            {
              x: mx,
              y: my + 2,
              'text-anchor': 'middle',
              fill: '#cbd5e1',
              'font-size': '11'
            },
            e.label
          )
        );
      }
    });

    // Render Nodes
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

    return svg;
  }

  /**
   * Render Mermaid ER Diagram (`erDiagram`) to SVG.
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
    const cols = Math.min(3, Math.max(1, list.length));
    const boxW = 220;
    const gapX = 290;
    const gapY = 210;

    list.forEach((ent, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      ent.x = 40 + col * gapX;
      ent.y = 40 + row * gapY;
      ent.w = boxW;
      ent.h = 36 + Math.max(1, ent.fields.length) * 24 + 8;
    });

    const totalW = Math.max(480, cols * gapX + 40);
    const totalH = Math.max(240, Math.ceil(list.length / cols) * gapY + 60);

    const svg = svgEl('svg', {
      viewBox: `0 0 ${totalW} ${totalH}`,
      width: totalW,
      height: totalH
    });

    // Draw relation lines
    relations.forEach((rel) => {
      const a = entities.get(rel.from);
      const b = entities.get(rel.to);
      if (!a || !b) return;
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h / 2;
      const x2 = b.x + b.w / 2;
      const y2 = b.y + b.h / 2;

      svg.appendChild(
        svgEl('line', {
          x1,
          y1,
          x2,
          y2,
          stroke: '#60a5fa',
          'stroke-width': '1.75'
        })
      );

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const lblW = rel.label.length * 7.5 + 16;
      svg.appendChild(
        svgEl('rect', {
          x: mx - lblW / 2,
          y: my - 11,
          width: lblW,
          height: 20,
          rx: 4,
          fill: '#0f172a',
          stroke: '#3b82f6'
        })
      );
      svg.appendChild(
        svgEl(
          'text',
          {
            x: mx,
            y: my + 3,
            'text-anchor': 'middle',
            fill: '#93c5fd',
            'font-size': '11'
          },
          rel.label
        )
      );
    });

    // Draw entity tables
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
          height: 32,
          rx: 8,
          fill: '#1e3a5f'
        })
      );
      g.appendChild(
        svgEl(
          'text',
          {
            x: ent.x + ent.w / 2,
            y: ent.y + 21,
            'text-anchor': 'middle',
            fill: '#f8fafc',
            'font-size': '13',
            'font-weight': '700'
          },
          ent.name
        )
      );

      ent.fields.forEach((f, fIdx) => {
        const fy = ent.y + 52 + fIdx * 24;
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
              x: ent.x + 84,
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

      svg.appendChild(g);
    });

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
   * Render an array of AST blocks into a container DOM element.
   * @param {HTMLElement} container
   * @param {Array<any>} blocks
   * @param {object} callbacks
   */
  function renderBlocksIntoDom(container, blocks, callbacks) {
    let activeHeadingText = '';

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      switch (block.type) {
        case 'heading': {
          activeHeadingText = block.text;
          const wrap = el('div', 'agy-heading-wrap', null, { id: block.id });
          const hTag = `h${Math.min(6, Math.max(1, block.level))}`;
          const hNode = el(hTag, 'agy-heading');
          appendInlineNodes(hNode, block.text, callbacks);
          wrap.appendChild(hNode);

          const commentBtn = el('button', 'agy-comment-trigger', '+ 批注 (Review)', {
            title: '对此章节添加 Antigravity Artifact 批注'
          });
          const capturedHeading = block.text;
          commentBtn.addEventListener('click', () => {
            if (callbacks && typeof callbacks.onOpenReviewModal === 'function') {
              callbacks.onOpenReviewModal(capturedHeading, '');
            }
          });
          wrap.appendChild(commentBtn);
          container.appendChild(wrap);
          break;
        }

        case 'paragraph': {
          const p = el('p', 'agy-p');
          appendInlineNodes(p, block.text, callbacks);
          container.appendChild(p);
          break;
        }

        case 'hr': {
          container.appendChild(el('hr', 'agy-hr'));
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
          renderBlocksIntoDom(body, nestedAst.blocks, callbacks);
          alertCard.appendChild(body);
          container.appendChild(alertCard);
          break;
        }

        case 'blockquote': {
          const bq = el('blockquote', 'agy-blockquote');
          const nestedAst = parseMarkdownToAst(block.body);
          renderBlocksIntoDom(bq, nestedAst.blocks, callbacks);
          container.appendChild(bq);
          break;
        }

        case 'list': {
          const listEl = el(block.ordered ? 'ol' : 'ul', 'agy-list');
          block.items.forEach((item) => {
            const li = el('li', item.isTask ? 'agy-task-item' : '');
            if (item.indent >= 2) {
              li.style.marginLeft = `${Math.min(4, Math.floor(item.indent / 2)) * 18}px`;
            }
            if (item.isTask) {
              const checkbox = el('input', 'agy-task-checkbox', null, { type: 'checkbox' });
              checkbox.checked = Boolean(item.checked);
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
          container.appendChild(listEl);
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
          block.rows.forEach((rowCells) => {
            const tr = el('tr');
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
          container.appendChild(wrap);
          break;
        }

        case 'code': {
          const card = el('div', 'agy-code-card');
          const header = el('div', 'agy-code-header');
          header.appendChild(el('span', 'agy-code-lang', block.lang || 'text'));

          const copyBtn = el('button', 'agy-copy-btn', '复制代码 (Copy)');
          copyBtn.addEventListener('click', () => {
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
          codeLines.forEach((lineText, idx) => {
            grid.appendChild(el('span', 'agy-line-num', String(idx + 1)));
            const codeLineSpan = el('span', 'agy-line-code');
            appendSyntaxHighlightedLine(codeLineSpan, lineText);
            grid.appendChild(codeLineSpan);
          });
          pre.appendChild(grid);
          card.appendChild(pre);
          container.appendChild(card);
          break;
        }

        case 'mermaid': {
          const card = el('div', 'agy-mermaid-card');
          const rendered = renderMermaidSvg(block.code);
          const toolbar = el('div', 'agy-mermaid-toolbar');
          toolbar.appendChild(el('span', 'agy-mermaid-title', `◇ Mermaid · ${rendered.diagramType}`));

          const controls = el('div', 'agy-mermaid-controls');
          const zoomOutBtn = el('button', 'agy-mermaid-btn', '－');
          const zoomResetBtn = el('button', 'agy-mermaid-btn', '100%');
          const zoomInBtn = el('button', 'agy-mermaid-btn', '＋');
          const toggleSrcBtn = el('button', 'agy-mermaid-btn', '源码 (DSL)');

          controls.appendChild(zoomOutBtn);
          controls.appendChild(zoomResetBtn);
          controls.appendChild(zoomInBtn);
          controls.appendChild(toggleSrcBtn);
          toolbar.appendChild(controls);
          card.appendChild(toolbar);

          const viewport = el('div', 'agy-mermaid-viewport');
          const stage = el('div', 'agy-mermaid-stage');
          stage.appendChild(rendered.svg);
          viewport.appendChild(stage);
          card.appendChild(viewport);

          const srcPre = el('pre', 'agy-mermaid-source', block.code);
          card.appendChild(srcPre);

          let scale = 1;
          const updateScale = (nextScale) => {
            scale = Math.min(2.5, Math.max(0.4, nextScale));
            stage.style.transform = `scale(${scale})`;
            zoomResetBtn.textContent = `${Math.round(scale * 100)}%`;
          };

          zoomInBtn.addEventListener('click', () => updateScale(scale + 0.15));
          zoomOutBtn.addEventListener('click', () => updateScale(scale - 0.15));
          zoomResetBtn.addEventListener('click', () => updateScale(1));
          toggleSrcBtn.addEventListener('click', () => {
            srcPre.classList.toggle('visible');
          });

          container.appendChild(card);
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
            renderBlocksIntoDom(body, slideAst.blocks, callbacks);

            dotsWrap.replaceChildren();
            slides.forEach((_s, dIdx) => {
              const dot = el('button', `agy-carousel-dot${dIdx === activeSlide ? ' active' : ''}`);
              dot.addEventListener('click', () => renderSlide(dIdx));
              dotsWrap.appendChild(dot);
            });
          };

          prevBtn.addEventListener('click', () => renderSlide(activeSlide - 1));
          nextBtn.addEventListener('click', () => renderSlide(activeSlide + 1));

          nav.appendChild(prevBtn);
          nav.appendChild(dotsWrap);
          nav.appendChild(nextBtn);
          header.appendChild(nav);

          card.appendChild(header);
          card.appendChild(body);
          renderSlide(0);
          container.appendChild(card);
          break;
        }

        case 'mathBlock': {
          container.appendChild(renderMathDom(block.expression, true));
          break;
        }

        default:
          break;
      }
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

    let state = {
      text: '',
      fileName: 'Document.md',
      filePath: '',
      baseWebviewUri: '',
      isDirty: false,
      isBrainArtifact: false,
      viewMode: 'preview',
      showOutline: true,
      initializedConfig: false,
      reviewHeading: '',
      reviewQuote: ''
    };

    // Build Top Header Bar
    const topbar = el('header', 'agy-topbar');
    const topLeft = el('div', 'agy-topbar-left');
    const badge = el('span', 'agy-badge', '✦ ARTIFACT');
    const fileTitle = el('span', 'agy-filename', state.fileName);
    const dirtyDot = el('span', 'agy-dirty-dot', null, { title: '有未保存的更改 (Ctrl+S 保存)' });
    dirtyDot.style.display = 'none';
    topLeft.appendChild(badge);
    topLeft.appendChild(fileTitle);
    topLeft.appendChild(dirtyDot);

    const topCenter = el('div', 'agy-topbar-center');
    const btnPreview = el('button', 'agy-mode-btn active', '预览 (Preview)');
    const btnSplit = el('button', 'agy-mode-btn', '分栏编辑 (Split)');
    const btnSource = el('button', 'agy-mode-btn', '源码 (Source)');
    topCenter.appendChild(btnPreview);
    topCenter.appendChild(btnSplit);
    topCenter.appendChild(btnSource);

    const topRight = el('div', 'agy-topbar-right');
    const btnOutline = el('button', 'agy-action-btn', '☰ 目录大纲');
    const btnNative = el('button', 'agy-action-btn primary', '✦ 原生内置视图 (jetski)');
    btnNative.setAttribute('title', '调用 Antigravity IDE 原生内置 antigravity.artifactEditor 打开当前文档');
    const btnTextEditor = el('button', 'agy-action-btn', '⟨/⟩ 默认编辑器');
    topRight.appendChild(btnOutline);
    topRight.appendChild(btnNative);
    topRight.appendChild(btnTextEditor);

    topbar.appendChild(topLeft);
    topbar.appendChild(topCenter);
    topbar.appendChild(topRight);

    // Main Workspace Container
    const workspace = el('div', 'agy-workspace');

    // Outline Sidebar
    const outlineAside = el('aside', 'agy-outline');
    const outlineHeader = el('div', 'agy-outline-header');
    outlineHeader.appendChild(el('span', '', '和大纲导航 (Outline)'));
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
    const docContainer = el('article', 'agy-document');
    previewPane.appendChild(docContainer);

    workspace.appendChild(outlineAside);
    workspace.appendChild(editorPane);
    workspace.appendChild(previewPane);

    // Floating Review Modal
    const reviewModal = el('div', 'agy-review-modal hidden');
    const reviewHeader = el('div', 'agy-review-header');
    const reviewTitle = el('span', '', '添加 Artifact 章节批注');
    const reviewCloseBtn = el('button', 'agy-mermaid-btn', '✕');
    reviewHeader.appendChild(reviewTitle);
    reviewHeader.appendChild(reviewCloseBtn);
    const reviewQuoteBox = el('div', 'agy-review-quote');
    const reviewInput = el('textarea', 'agy-review-input', '', {
      placeholder: '输入针对该章节的修改意见或批注...'
    });
    const reviewActions = el('div', 'agy-review-actions');
    const reviewSubmitBtn = el('button', 'agy-action-btn primary', '生成并复制批注');
    reviewActions.appendChild(reviewSubmitBtn);
    reviewModal.appendChild(reviewHeader);
    reviewModal.appendChild(reviewQuoteBox);
    reviewModal.appendChild(reviewInput);
    reviewModal.appendChild(reviewActions);

    root.replaceChildren(topbar, workspace, reviewModal);

    // Mode Switching
    function applyViewMode(mode) {
      state.viewMode = mode;
      btnPreview.classList.toggle('active', mode === 'preview');
      btnSplit.classList.toggle('active', mode === 'split');
      btnSource.classList.toggle('active', mode === 'source');

      editorPane.classList.toggle('hidden', mode === 'preview');
      previewPane.classList.toggle('hidden', mode === 'source');
    }

    function applyOutlineVisibility(visible) {
      state.showOutline = visible;
      outlineAside.classList.toggle('hidden', !visible);
    }

    btnPreview.addEventListener('click', () => applyViewMode('preview'));
    btnSplit.addEventListener('click', () => applyViewMode('split'));
    btnSource.addEventListener('click', () => applyViewMode('source'));
    btnOutline.addEventListener('click', () => applyOutlineVisibility(!state.showOutline));

    btnNative.addEventListener('click', () => {
      if (vscode) {
        vscode.postMessage({ type: 'openNative' });
      }
    });

    btnTextEditor.addEventListener('click', () => {
      if (vscode) {
        vscode.postMessage({ type: 'switchToTextEditor' });
      }
    });

    reviewCloseBtn.addEventListener('click', () => {
      reviewModal.classList.add('hidden');
    });

    /**
     * Resolve 1-based [startLineNumber, endLineNumber] in state.text for a snippet or textarea selection.
     * @param {string} snippet
     * @returns {{ startLineNumber: number, endLineNumber: number }}
     */
    function findLineRangeForSnippet(snippet) {
      if (document.activeElement === sourceTextarea) {
        const startOffset = sourceTextarea.selectionStart || 0;
        const endOffset = Math.max(startOffset, sourceTextarea.selectionEnd || startOffset);
        const startLineNumber = state.text.slice(0, startOffset).split('\n').length;
        const endLineNumber = state.text.slice(0, endOffset).split('\n').length;
        return { startLineNumber, endLineNumber };
      }

      const clean = String(snippet || '').trim();
      if (!clean) {
        return { startLineNumber: 1, endLineNumber: 1 };
      }

      const idx = state.text.indexOf(clean);
      if (idx !== -1) {
        const startLineNumber = state.text.slice(0, idx).split('\n').length;
        const endLineNumber = startLineNumber + clean.split('\n').length - 1;
        return { startLineNumber, endLineNumber };
      }

      const firstLine = clean.split('\n')[0].trim();
      if (firstLine) {
        const lines = state.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(firstLine)) {
            const span = Math.max(1, clean.split('\n').length);
            return {
              startLineNumber: i + 1,
              endLineNumber: Math.min(lines.length, i + span)
            };
          }
        }
      }

      return { startLineNumber: 1, endLineNumber: 1 };
    }

    reviewSubmitBtn.addEventListener('click', () => {
      if (vscode && reviewInput.value.trim()) {
        const range = findLineRangeForSnippet(state.reviewQuote || state.reviewHeading);
        vscode.postMessage({
          type: 'submitReviewComment',
          heading: state.reviewHeading,
          selectedText: state.reviewQuote,
          startLineNumber: range.startLineNumber,
          endLineNumber: range.endLineNumber,
          comment: reviewInput.value.trim()
        });
        reviewInput.value = '';
        reviewModal.classList.add('hidden');
      }
    });

    // Live editing in Split / Source mode
    let editTimer = null;
    sourceTextarea.addEventListener('input', () => {
      state.text = sourceTextarea.value;
      renderDocument();
      if (editTimer) {
        clearTimeout(editTimer);
      }
      editTimer = setTimeout(() => {
        if (vscode) {
          vscode.postMessage({ type: 'edit', text: sourceTextarea.value });
        }
      }, 160);
    });

    // Support Ctrl+S / Cmd+S to save and Ctrl+L / Cmd+L to send selection to Antigravity Chat
    window.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        if (vscode) {
          vscode.postMessage({ type: 'save' });
        }
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'l') {
        ev.preventDefault();
        if (vscode) {
          const sel = window.getSelection ? String(window.getSelection()).trim() : '';
          const range = findLineRangeForSnippet(sel);
          vscode.postMessage({
            type: 'addSelectionToChat',
            startLineNumber: range.startLineNumber,
            endLineNumber: range.endLineNumber,
            selectedText: sel
          });
        }
      }
    });

    const callbacks = {
      get baseWebviewUri() {
        return state.baseWebviewUri;
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
      onOpenReviewModal(headingText, quoteText) {
        state.reviewHeading = headingText;
        const sel = window.getSelection ? String(window.getSelection()).trim() : '';
        state.reviewQuote = quoteText || sel || headingText;
        reviewTitle.textContent = `批注: ${headingText}`;
        reviewQuoteBox.textContent = state.reviewQuote;
        reviewModal.classList.remove('hidden');
        reviewInput.focus();
      }
    };

    function renderDocument() {
      fileTitle.textContent = state.fileName;
      fileTitle.setAttribute('title', state.filePath);
      dirtyDot.style.display = state.isDirty ? 'inline-block' : 'none';
      badge.textContent = state.isBrainArtifact ? '✦ BRAIN ARTIFACT' : '✦ PROJECT ARTIFACT';
      badge.classList.toggle('is-brain', Boolean(state.isBrainArtifact));

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
      if (!msg || msg.type !== 'documentUpdate') {
        return;
      }

      state.text = msg.text || '';
      state.fileName = msg.fileName || 'Document.md';
      state.filePath = msg.filePath || '';
      state.baseWebviewUri = msg.baseWebviewUri || '';
      state.isDirty = Boolean(msg.isDirty);
      state.isBrainArtifact = Boolean(msg.isBrainArtifact);

      if (!state.initializedConfig && msg.config) {
        state.initializedConfig = true;
        applyViewMode(msg.config.defaultViewMode || 'preview');
        applyOutlineVisibility(msg.config.showOutline !== false);
      }

      if (document.activeElement !== sourceTextarea) {
        sourceTextarea.value = state.text;
      }

      renderDocument();
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
      appendInlineNodes,
      renderBlocksIntoDom
    };
  }
})();

