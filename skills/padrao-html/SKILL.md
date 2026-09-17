---
name: padrao-html
description: Cria relatórios HTML responsivos, autônomos e interativos com visual laranja glass, gráficos, filtros e exportação de dados.
---

# Padrão HTML para relatórios

Use esta skill ao criar ou reformular relatórios analíticos em HTML. O resultado deve ser um único arquivo `.html`, pronto para abrir localmente e sem depender de internet, bibliotecas externas ou arquivos auxiliares.

## Estrutura do relatório

- Apresente título, período analisado, origem dos dados e cartões com os indicadores mais relevantes.
- Inclua gráficos que respondam às perguntas principais do relatório. Use SVG ou Canvas embutido; não carregue CDNs.
- Forneça filtros adequados ao conjunto de dados (por exemplo: período, categoria, conta, status ou busca textual). A filtragem deve ocorrer no navegador e atualizar contagens, totais e visualizações afetadas.
- Inclua uma tabela detalhada pesquisável, com ordenação ou ordenação inicial útil, e tratamento legível para valores ausentes.
- Disponibilize um botão de download que exporte os dados atualmente filtrados em CSV UTF-8 com BOM. Nomeie o arquivo de forma descritiva.

## Tema visual: laranja glass

- Use fundo escuro com gradiente em tons de grafite, vinho profundo e laranja queimado; use superfícies de conteúdo em vidro translúcido (`backdrop-filter: blur(...)`) com bordas claras sutis.
- A cor de ação e destaque é laranja. Use variações de âmbar e pêssego para hierarquia, e verde/vermelho apenas para semântica positiva/negativa.
- Preserve contraste alto para textos e indicadores. Não use transparência onde ela reduza a legibilidade.
- Crie um layout limpo, com cartões arredondados, sombras suaves, boa densidade de informação e tipografia nativa do sistema.
- Garanta adaptação real para telas pequenas: cartões, filtros, gráficos e tabela devem permanecer utilizáveis sem corte do conteúdo. Permita rolagem horizontal apenas dentro de tabelas grandes.

## Qualidade e segurança

- Não inclua dados de exemplo quando houver dados fornecidos pelo usuário.
- Escape textos inseridos no HTML e trate valores nulos, datas e números antes de renderizar.
- Mantenha os dados e o JavaScript necessários incorporados no documento, com controles funcionais mesmo sem conexão.
- Inclua regras de impressão que favoreçam contraste, removam controles interativos e preservem os dados principais.
- Antes de entregar, valide o HTML e teste os filtros e o download em proporção ao tamanho do relatório.

Adapte as métricas, rótulos e critérios de cálculo ao domínio dos dados. Não assuma classificações financeiras, metas ou interpretações que não estejam presentes ou autorizadas pelo usuário.
