module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const { id } = req.query;

  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN não configurado.' });
  if (!id) return res.status(400).json({ error: 'ID da página não informado.' });

  try {
    const blocks = await fetchAllBlocks(id, NOTION_TOKEN);
    const content = await extractText(blocks, NOTION_TOKEN, 0);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ content });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

async function fetchAllBlocks(blockId, token) {
  let results = [];
  let cursor = undefined;
  do {
    const url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(err);
    }
    const data = await response.json();
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function extractText(blocks, token, depth, counters) {
  const indent = '  '.repeat(depth);
  if (!counters) counters = {};
  const numKey = `num_${depth}`;
  const lines = [];

  for (const block of blocks) {
    const type = block.type;
    const rich = block[type]?.rich_text;
    const text = rich ? rich.map((r) => {
      let t = r.plain_text;
      if (r.annotations?.bold)   t = `**${t}**`;
      if (r.annotations?.italic) t = `_${t}_`;
      if (r.annotations?.code)   t = `\`${t}\``;
      if (r.href)                t = `[${t}](${r.href})`;
      return t;
    }).join('') : '';

    // Reset counter se não for lista numerada
    if (type !== 'numbered_list_item') {
      counters[numKey] = 0;
    }

    let line = '';
    if (type === 'heading_1')               line = `## ${text}`;
    else if (type === 'heading_2')          line = `### ${text}`;
    else if (type === 'heading_3')          line = `#### ${text}`;
    else if (type === 'bulleted_list_item') line = `${indent}• ${text}`;
    else if (type === 'numbered_list_item') {
      counters[numKey] = (counters[numKey] || 0) + 1;
      const n = counters[numKey];
      // depth 0 → 1, 2, 3 | depth 1 → a, b, c | depth 2+ → i, ii, iii
      let prefix;
      if (depth === 0)      prefix = `${n}.`;
      else if (depth === 1) prefix = `${String.fromCharCode(96 + n)}.`;
      else                  prefix = toRoman(n) + '.';
      line = `${indent}${prefix} ${text}`;
    }
    else if (type === 'to_do') {
      const checked = block.to_do?.checked ? '☑' : '☐';
      line = `${indent}${checked} ${text}`;
    }
    else if (type === 'toggle')   line = `${indent}▸ ${text}`;
    else if (type === 'quote')    line = `${indent}❝ ${text}`;
    else if (type === 'callout') {
      const emoji = block.callout?.icon?.emoji || '💡';
      line = `${emoji} ${text}`;
    }
    else if (type === 'divider')   line = `---`;
    else if (type === 'paragraph') line = text ? `${indent}${text}` : `\n`;
    else if (text)                 line = `${indent}${text}`;

    if (line) lines.push(line);

    // Busca filhos recursivamente (sub-listas, toggles, etc.)
    if (block.has_children) {
      const children = await fetchAllBlocks(block.id, token);
      const childText = await extractText(children, token, depth + 1, counters);
      if (childText) lines.push(childText);
    }
  }

  return lines.filter(Boolean).join('\n');
}

function toRoman(n) {
  const vals = [10,'x',9,'ix',5,'v',4,'iv',1,'i'];
  let result = '';
  for (let i = 0; i < vals.length; i += 2) {
    while (n >= vals[i]) { result += vals[i+1]; n -= vals[i]; }
  }
  return result;
}
