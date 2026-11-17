# Flow Control — Central de Controle

Sistema web para acompanhar o fluxo produtivo de uma fábrica: lotes por operação, inventário de abertura e rastreabilidade da matéria-prima, com integração de leitura ao ERP TOTVS Protheus.

> Versão de portfólio: nomes de peças, códigos e endereços de rede são fictícios.

## Tecnologias

- FastAPI para APIs e servidor local
- React 19 + TypeScript para a interface
- Vite 8 para desenvolvimento e compilação do frontend
- CSS Modules por componente sobre tokens globais (`frontend/src/styles`)
- Vitest + Testing Library para os testes de interface
- Fonte Inter empacotada localmente em `frontend/public/assets/fonts`

O build do Vite em `frontend/dist` é a **única** interface servida pelo FastAPI.
Não existe implementação paralela: `fallback.js`, `fallback.css` e os desenhos
das peças foram removidos do projeto e do build.

### Interface

```powershell
cd frontend
npm install        # ou pnpm install
npm run test       # Vitest + Testing Library
npm run build      # typecheck + build de produção em frontend/dist
```

As peças são identificadas por **nome**, **código oficial**, **quantidade já
produzida** e **quantidade em processo**. Nenhuma imagem de peça é distribuída.
Valor oficial igual a zero aparece como `0`; valor indisponível aparece como
`Não informado` ou `—`, nunca como zero.

## Desenvolvimento

Execute `Iniciar Flow Control.cmd` ou, na raiz do projeto, use o launcher. Ele
testa nesta ordem `FLOW_PYTHON`, `.venv\\Scripts\\python.exe`, `python`, `py` e
o fallback dinâmico de desenvolvimento
`%USERPROFILE%\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe`.
Nenhum candidato é escolhido apenas por existir: o launcher exige o probe real
`import fastapi, uvicorn, pydantic_core`, valida o health e a API antes de
abrir o navegador.

Para iniciar manualmente com um ambiente compatível:

```powershell
& .venv\\Scripts\\python.exe backend\\run_server.py
```

O fallback em `%USERPROFILE%\\.cache\\codex-runtimes` é somente uma conveniência
de desenvolvimento local do Codex e não é portátil. Em outra máquina, crie um
`.venv` com versões compatíveis e as dependências instaladas, ou defina
`FLOW_PYTHON` para um runtime equivalente.

- Nesta máquina: `http://127.0.0.1:5027`
- Na rede local: `http://192.168.0.18:5027`

O endereço de rede é o IP atual desta máquina e pode mudar via DHCP. Confirme-o
com `ipconfig` antes de compartilhar o acesso. Se o Windows solicitar acesso no
firewall, autorize somente redes **privadas**; o projeto não cria regra de
firewall e não deve ser exposto deliberadamente à internet.

O servidor usa `0.0.0.0:5027` por padrão. Para um uso local específico, é
possível definir `FLOW_HOST` e `FLOW_PORT`; para desenvolvimento Vite em outro
endereço privado, `FLOW_CORS_ORIGINS` aceita origens separadas por vírgula.

O frontend é compilado pelo Vite quando as dependências locais estiverem disponíveis.

### Smoke test local e LAN

Com o servidor em execução, valide sem usar proxy HTTP (o IP LAN pode variar
por DHCP):

```powershell
Invoke-WebRequest -UseBasicParsing -NoProxy http://127.0.0.1:5027/api/health
$lanProducts = Invoke-RestMethod -UseBasicParsing -NoProxy http://192.168.0.18:5027/api/products
$lanProducts.Count  # esperado: 13
```

O smoke LAN deve registrar HTTP `200` e `13` produtos quando o endereço estiver
alcançável a partir da máquina cliente. Se a chamada remota estiver pendente,
registre-a como não executada/sem conectividade confirmada; não conclua a causa
(por exemplo, firewall) sem evidência específica.

## Banco de apontamentos

As configurações locais ficam em `.env.local`, arquivo excluído pelo `.gitignore`. A aplicação consulta `public.apontamentos` para quantidade, perda e processo e usa o schema próprio `flow_control` para persistir o inventário de abertura e os lotes do novo controle.

A URL de conexão não deve ser gravada no repositório. Estoque e transferências continuam fora dessa integração e devem vir do TOTVS.

## Início do controle em 01/09/2026

- `SB2010` fornece o saldo do vergalhão no Armazém 1.
- `SD3010` fornece as transferências para o Armazém 4.
- `D3_NUMSERI` identifica o código da peça de destino.
- Cada transferência consolidada posterior ao marco cria um lote; os fardos não recebem identificação individual.
- Movimentações anteriores a `2026-09-01` não criam lotes oficiais.
- O menu **Inventário de Abertura** registra peça, operação atual, situação
  (`Aguardando` ou `Em processo`), quantidade, kg de vergalhão, responsável e
  observação. Um produto aceita **várias posições**: a chave oficial é
  `(data, produto, operação, situação)`.
- `GET /api/inventory/opening` conta **produtos distintos** com registro
  obrigatório completo e devolve `pending_product_ids`; o inventário não fica
  pronto só porque o número de linhas coincide com o de produtos.
- `GET /api/catalog/production` devolve produzido e em processo das 13 peças em
  uma única leitura de `public.apontamentos`, usando a mesma regra de cálculo do
  controle da peça.
- `GET /api/readiness` verifica configuração TOTVS, banco do controle e data de ativação.
- `POST /api/totvs/{produto}/sync` sincroniza sem duplicidade após a data de ativação; antes dela retorna `scheduled`.

## Lotes no processo

- **Aguardando**: lote registrado na fila e ainda não iniciado na operação.
- **Em processo**: lote que ocupa a operação neste momento.
- **Resguardado**: lote interrompido, preservado na mesma operação para retomada posterior.
- Ao iniciar ou retomar outro lote na mesma operação, o lote ativo é resguardado automaticamente.
- Cada transição gera um evento imutável com estado anterior, novo estado, processo, responsável, motivo e horário.
- O quadro **Lotes em Processo** permite criar, iniciar, resguardar, retomar, avançar e concluir lotes.
