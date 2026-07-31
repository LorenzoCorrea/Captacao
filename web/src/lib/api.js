// Leitura honesta de respostas da API.
//
// Chamar r.json() direto transformava um corpo vazio (API caída ou reiniciando,
// proxy do Vite sem alvo) no críptico "Unexpected end of JSON input" — erro que
// escondia a causa real e mandava o usuário procurar no lugar errado. Aqui cada
// caso vira uma mensagem que diz o que houve e onde olhar.
export async function lerJson(r) {
  const texto = await r.text();
  if (!texto.trim()) {
    throw new Error(
      `O servidor respondeu sem conteúdo${r.ok ? '' : ` (HTTP ${r.status})`}. ` +
        'Isso costuma ser a API fora do ar ou reiniciando — confira a janela do terminal onde roda o npm run dev (linhas [api]).'
    );
  }
  let data;
  try {
    data = JSON.parse(texto);
  } catch {
    // Corpo não-JSON: página de erro do proxy, HTML do Vite, stack trace…
    throw new Error(`Resposta inesperada do servidor (HTTP ${r.status}): ${texto.slice(0, 140)}`);
  }
  if (!r.ok) throw new Error(data.error ?? `O servidor respondeu HTTP ${r.status}.`);
  return data;
}
