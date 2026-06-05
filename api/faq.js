api/faq.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const DATABASE_ID = process.env.NOTION_DATABASE_ID || '18ea52959df945588cd6e870b1805444';

  if (!NOTION_TOKEN) {
    return res.status(500).json({ error: 'NOTION_TOKEN não configurado.' });
  }

  try {
    let allResults = [];
    let cursor = undefined;

    do {
      const body = {
        filter: { property: 'Status', select: { equals: 'Ativo' } },
        sorts: [{ property: 'Categoria', direction: 'ascending' }],
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;

      const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }

      const data = await response.json();
      allResults = allResults.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const items = await Promise.all(
      allResults.map(async (page) => {
        const props = page.properties;
        const titulo = props['Título']?.title?.[0]?.plain_text || '';
        const categoria = props['Categoria']?.select?.name || 'Outros';
        const audiencia = props['Audiência']?.multi_select?.map((a) => a.name) || [];
        const fonte = props['Fonte']?.select?.name || '';
        const tags = props['Tags']?.multi_select?.map((t) => t.name) || [];

        // Busca o conteúdo da página
        let conteudo = '';
        try {
          const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=100`, {
            headers: {
              Authorization: `Bearer ${NOTION_TOKEN}`,
              'Notion-Version': '2022-06-28',
            },
          });
          if (blocksRes.ok) {
            const blocksData = await blocksRes.json();
            conteudo = extractText(blocksData.results);
          }
        } catch (_) {}

        return { id: page.id, titulo, categoria, audiencia, fonte, tags, conteudo };
      })
    );

    // Cache por 5 minutos
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(items.filter((i) => i.titulo));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

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
