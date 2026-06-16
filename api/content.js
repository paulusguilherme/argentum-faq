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

async function extractText(blocks, token, depth) {
  const indent = '  '.repeat(depth);
  let numCounter = 0;
  const lines = [];

  for (const block of blocks) {
    const type = block.type;
    const rich = block[type]?.rich_text;
    const text = rich ? rich.map((r) => r.plain_text).join('') : '';

    // reset numbered counter when not a numbered list item
    if (type !== 'numbered_list_item') numCounter = 0;

    let line = '';
    if (type === 'heading_1')               line = `## ${text}`;
    else if (type === 'heading_2')          line = `### ${text}`;
    else if (type === 'heading_3')          line = `#### ${text}`;
    else if (type === 'bulleted_list_item') line = `${indent}• ${text}`;
    else if (type === 'numbered_list_item') {
      numCounter++;
      line = `${indent}${numCounter}. ${text}`;
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
    else if (type === 'divider')  line = `---`;
    else if (type === 'paragraph') line = text ? `${indent}${text}` : '';
    else if (text)                 line = `${indent}${text}`;

    if (line) lines.push(line);

    // Busca filhos recursivamente (sub-listas, toggles, etc.)
    if (block.has_children) {
      const children = await fetchAllBlocks(block.id, token);
      const childText = await extractText(children, token, depth + 1);
      if (childText) lines.push(childText);
    }
  }

  return lines.filter(Boolean).join('\n');
}
