module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const { id } = req.query;

  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN não configurado.' });
  if (!id) return res.status(400).json({ error: 'ID da página não informado.' });

  try {
    // 1. Achata todos os blocos com profundidade preservada
    const flat = await flattenBlocks(id, NOTION_TOKEN, 0);

    // 2. Renderiza numa única passagem com contadores globais por nível
    const content = renderBlocks(flat);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ content });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/* ── Busca paginada de filhos de um bloco ── */
async function fetchChildren(blockId, token) {
  let results = [];
  let cursor;
  do {
    const url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

/* ── Achata a árvore de blocos em lista plana [{block, depth}] ── */
async function flattenBlocks(blockId, token, depth) {
  const blocks = await fetchChildren(blockId, token);
  const flat = [];
  for (const block of blocks) {
    flat.push({ block, depth });
    if (block.has_children) {
      const children = await flattenBlocks(block.id, token, depth + 1);
      flat.push(...children);
    }
  }
  return flat;
}

/* ── Extrai texto rico (negrito, itálico, links) de rich_text ── */
function richText(rich) {
  if (!rich) return '';
  return rich.map((r) => {
    let t = r.plain_text;
    if (r.annotations?.bold)   t = `**${t}**`;
    if (r.annotations?.italic) t = `_${t}_`;
    if (r.annotations?.code)   t = `\`${t}\``;
    if (r.href)                t = `[${t}](${r.href})`;
    return t;
  }).join('');
}

/* ── Renderiza a lista plana com contadores sequenciais globais por nível ── */
function renderBlocks(flat) {
  const counters = {};
  const lines    = [];
  let inTable        = false;
  let tableRows      = [];
  let tableHasHeader = false;

  const flushTable = () => {
    if (!tableRows.length) { inTable = false; return; }
    const out = ['NOTION_TABLE'];
    tableRows.forEach((cells, i) => {
      const prefix = (tableHasHeader && i === 0) ? 'H' : 'R';
      out.push(prefix + ':' + cells.map(cell => richText(cell) || '').join('\t'));
    });
    out.push('NOTION_TABLE_END');
    lines.push(out.join('\n'));
    tableRows = [];
    inTable   = false;
  };

  for (const { block, depth } of flat) {
    const type = block.type;

    // Acumula linhas de tabela
    if (type === 'table_row') {
      if (inTable) { tableRows.push(block.table_row?.cells || []); continue; }
    } else if (inTable) {
      flushTable();
    }

    if (type === 'table') {
      inTable        = true;
      tableHasHeader = block.table?.has_column_header || false;
      continue;
    }

    const text = richText(block[type]?.rich_text);
    const ind  = '  '.repeat(depth);

    if (type !== 'numbered_list_item') {
      Object.keys(counters).forEach((d) => {
        if (Number(d) >= depth) counters[d] = 0;
      });
    }

    let line = '';

    if (type === 'heading_1')               line = `## ${text}`;
    else if (type === 'heading_2')          line = `### ${text}`;
    else if (type === 'heading_3')          line = `#### ${text}`;
    else if (type === 'bulleted_list_item') line = `${ind}• ${text}`;
    else if (type === 'numbered_list_item') {
      if (depth === 0) {
        counters[0] = (counters[0] || 0) + 1;
        line = `${counters[0]}. ${text}`;
      } else {
        line = `${ind}${text}`;
      }
    }
    else if (type === 'to_do') {
      const checked = block.to_do?.checked ? '☑' : '☐';
      line = `${ind}${checked} ${text}`;
    }
    else if (type === 'toggle')   line = `${ind}▸ ${text}`;
    else if (type === 'quote')    line = `${ind}❝ ${text}`;
    else if (type === 'callout') {
      const emoji = block.callout?.icon?.emoji || '💡';
      line = `${emoji} ${text}`;
    }
    else if (type === 'divider')      line = `---`;
    else if (type === 'paragraph')    line = text ? `${ind}${text}` : '\n';
    else if (type === 'bookmark') {
      const url     = block.bookmark?.url || '';
      const caption = richText(block.bookmark?.caption);
      line = `[${caption || url}](${url})`;
    }
    else if (type === 'link_preview') {
      const url = block.link_preview?.url || '';
      line = `[${url}](${url})`;
    }
    else if (type === 'embed') {
      const url = block.embed?.url || '';
      line = `[${url}](${url})`;
    }
    else if (text) line = `${ind}${text}`;

    if (line) lines.push(line);
  }

  if (inTable) flushTable();

  return lines.filter(Boolean).join('\n');
}

function toRoman(n) {
  const vals = [10,'x',9,'ix',5,'v',4,'iv',1,'i'];
  let r = '';
  for (let i = 0; i < vals.length; i += 2)
    while (n >= vals[i]) { r += vals[i + 1]; n -= vals[i]; }
  return r;
}
