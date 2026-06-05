module.exports = async function handler(req, res) {
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

    // Retorna apenas metadados (sem conteúdo dos blocos - carregado sob demanda)
    const items = allResults.map((page) => {
      const props = page.properties;
      return {
        id: page.id,
        titulo: props['Título']?.title?.[0]?.plain_text || '',
        categoria: props['Categoria']?.select?.name || 'Outros',
        audiencia: props['Audiência']?.multi_select?.map((a) => a.name) || [],
        fonte: props['Fonte']?.select?.name || '',
        tags: props['Tags']?.multi_select?.map((t) => t.name) || [],
      };
    }).filter((i) => i.titulo);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(items);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
