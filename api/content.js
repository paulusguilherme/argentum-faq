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
  // contadores[depth] = número atual naquele nível (números ou letras)
  const counters = {};
  const lines = [];

  for (const { block, depth } of flat) {
    const type  = block.type;
    const text  = richText(block[type]?.rich_text);
    const ind   = '  '.repeat(depth);

    // Ao encontrar qualquer bloco que NÃO seja lista numerada,
    // zera os contadores desse nível E de todos os níveis mais profundos.
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
      counters[depth] = (counters[depth] || 0) + 1;
      const n = counters[depth];
      // nível 0 → 1, 2, 3 | nível 1 → a, b, c (sequencial global) | nível 2+ → i, ii, iii
      let prefix;
      if (depth === 0)      prefix = `${n}.`;
      else if (depth === 1) prefix = `${String.fromCharCode(96 + n)}.`;
      else                  prefix = toRoman(n) + '.';
      line = `${ind}${prefix} ${text}`;
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
    else if (type === 'divider')   line = `---`;
    else if (type === 'paragraph') line = text ? `${ind}${text}` : '\n';
    else if (text)                 line = `${ind}${text}`;

    if (line) lines.push(line);
  }

  return lines.filter(Boolean).join('\n');
}

function toRoman(n) {
  const vals = [10,'x',9,'ix',5,'v',4,'iv',1,'i'];
  let r = '';
  for (let i = 0; i < vals.length; i += 2)
    while (n >= vals[i]) { r += vals[i + 1]; n -= vals[i]; }
  return r;
}
