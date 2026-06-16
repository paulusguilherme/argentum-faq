module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const { id } = req.query;

  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN não configurado.' });
  if (!id) return res.status(400).json({ error: 'ID da página não informado.' });

  try {
    const response = await fetch(`https://api.notion.com/v1/blocks/${id}/children?page_size=100`, {
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const content = extractText(data.results);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ content });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

function extractText(blocks) {
  return blocks
    .map((block) => {
      const type = block.type;
      const rich = block[type]?.rich_text;
      if (!rich) return '';
      const text = rich.map((r) => r.plain_text).join('');
      if (type === 'heading_1') return `## ${text}`;
      if (type === 'heading_2') return `### ${text}`;
      if (type === 'heading_3') return `#### ${text}`;
      if (type === 'bulleted_list_item') return `• ${text}`;
      if (type === 'numbered_list_item') return `${text}`;
      return text;
    })
    .filter(Boolean)
    .join('\n');
}
