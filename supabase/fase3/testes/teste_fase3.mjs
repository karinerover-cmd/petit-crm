process.on('uncaughtException',e=>{console.log('ERRO INESPERADO:',String(e.message||e).slice(0,200));process.exit(2)});
import { PGlite } from '@electric-sql/pglite'; import fs from 'fs';
const d = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';
const db = new PGlite();
await db.exec(fs.readFileSync('crm_stub.sql', 'utf8').split('-- a venda que já existe no CRM')[0]);
await db.exec(`insert into canais(nome,tipo) values ('Bagy','online'),('Endossa Asa Sul','consignacao'),('Endossa Augusta','consignacao'),('Feira','fisico'),('Instagram','online'),('WhatsApp','online');`);
for (const f of ['supabase/migrations/20260918120000_fase1_schema_estoque_venda.sql', 'supabase/migrations/20260918120100_fase1_seed_regras_desconto.sql']) await db.exec(fs.readFileSync(d + f, 'utf8'));
await db.exec(`insert into clientes(nome,telefone) values ('Cliente Bagy','61999990000');`);
for (const b of JSON.parse(fs.readFileSync(d + 'migracao/bagy_crm_2026.json', 'utf8')))
  await db.exec(`insert into vendas(cliente_id,canal_id,valor,data_venda,bagy_pedido_id) select (select id from clientes limit 1),(select id from canais where nome='Bagy'),${b.valor},'${b.data_venda}','${b.bagy_pedido_id}'`);
const mig = fs.readFileSync(d + 'supabase/fase2/01_migracao_2026.sql', 'utf8'); const FIM = 'end $mig$;';
await db.query(mig.slice(mig.indexOf('do $mig$'), mig.indexOf(FIM) + FIM.length));
await db.exec(fs.readFileSync(d + 'supabase/fase3/20260919120000_fase3_funcoes_app.sql', 'utf8'));

await db.exec("grant usage on schema public to anon, authenticated; grant all on all tables in schema public to authenticated; grant select on all tables in schema public to anon;");
await db.exec('set role authenticated');
const q = async (s, p) => (await db.query(s, p)).rows;
let ok = 0, ko = 0;
const t = (nome, cond, extra = '') => { if (cond) { ok++; console.log('  ✔', nome); } else { ko++; console.log('  ✘ FALHA:', nome, extra); } };
const falha = async (nome, fn, trecho) => { try { await fn(); t(nome, false, '(deveria ter dado erro)'); } catch (e) { t(nome + ' → erro esperado', trecho ? e.message.includes(trecho) : true, e.message.slice(0, 90)); } };
const est = async sku => (await q('select estoque_atual e from produtos where sku=$1', [sku]))[0]?.e;
const rpc = async (fn, ...args) => (await q(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args))[0].r;

console.log('— Vendas');
const e0 = await est('BB001'), e1 = await est('BB002');
const v1 = await rpc('gestao_registrar_venda', JSON.stringify({ data: '2026-09-19', canal: 'Feira', forma_pagamento: 'Pix', cliente: { nome: 'Maria Teste', tel: '(61) 98888-7777', email: 'maria@x.com', salvar: true },
  itens: [{ sku: 'BB001', nome: 'CREME HIDRATANTE LAVANDA', preco: 64.9, qtd: 2, desconto: 12.98, label: '10%' }, { sku: 'BB002', preco: 64.9, qtd: 1, desconto: 0 }], desconto_venda: 5, obs: 'teste', origem: 'gestao' }));
const V = (await q('select * from vendas where id=$1', [v1]))[0];
t('venda gravada com total certo (2×64,90−12,98 + 64,90 − 5 = 176,72)', Number(V.valor) === 176.72, V.valor);
t('origem gestao / forma Pix / desconto da venda', V.origem === 'gestao' && V.forma_pagamento === 'Pix' && Number(V.desconto_venda) === 5);
t('estoque baixou (BB001 −2, BB002 −1)', (await est('BB001')) === e0 - 2 && (await est('BB002')) === e1 - 1);
t('cliente criado e ligado', (await q("select count(*) c from clientes where nome='Maria Teste' and telefone is not null"))[0].c === 1 && V.cliente_id);
t('itens gravados com desconto e rótulo', (await q('select count(*) c from venda_itens where venda_id=$1 and desconto_label is not null', [v1]))[0].c === 1);
const v2 = await rpc('gestao_registrar_venda', JSON.stringify({ data: '2026-09-19', canal: 'Feira', cliente: { nome: 'Maria Teste', tel: '61988887777', salvar: true }, itens: [{ sku: 'BB003', preco: 64.9, qtd: 1 }], origem: 'gestao' }));
t('mesmo telefone reaproveita o cliente (sem duplicar)', (await q("select count(*) c from clientes where nome='Maria Teste'"))[0].c === 1);
const v3 = await rpc('gestao_registrar_venda', JSON.stringify({ data: '2026-09-19', canal: 'WhatsApp', cliente: { nome: 'Sem Cadastro', tel: '61911112222', salvar: false }, itens: [{ sku: 'BB003', preco: 64.9, qtd: 1 }], origem: 'gestao' }));
const V3 = (await q('select cliente_id, observacao from vendas where id=$1', [v3]))[0];
t('cliente não salvo: fica só na observação', V3.cliente_id === null && /Sem Cadastro/.test(V3.observacao) && (await q("select count(*) c from clientes where nome='Sem Cadastro'"))[0].c === 0);
const vv = JSON.stringify({ data: '2026-09-19', canal: 'Feira', forma_pagamento: 'Pix', itens: [{ sku: 'BB005', preco: 24.9, qtd: 1 }], origem: 'app_vendedor', pedido_externo: 'VEND-77' });
const a = await rpc('gestao_registrar_venda', vv), b = await rpc('gestao_registrar_venda', vv);
t('importação do vendedor: 2ª vez não duplica', a && b === null && (await q("select count(*) c from vendas where pedido_externo='VEND-77'"))[0].c === 1);
await falha('canal inexistente', () => rpc('gestao_registrar_venda', JSON.stringify({ canal: 'Não existe', itens: [{ sku: 'BB001', preco: 1, qtd: 1 }] })), 'não existe');
await falha('produto inexistente (nada é gravado)', () => rpc('gestao_registrar_venda', JSON.stringify({ canal: 'Feira', itens: [{ sku: 'ZZZ', preco: 1, qtd: 1 }] })), 'não existe');
t('venda com produto inexistente não deixou venda pela metade', (await q("select count(*) c from vendas where valor=1")).length && (await q("select count(*) c from vendas where valor = 1 and origem='gestao'"))[0].c === 0);
await falha('venda sem itens', () => rpc('gestao_registrar_venda', JSON.stringify({ canal: 'Feira', itens: [] })), 'pelo menos um');
const antes = await est('BB001');
await rpc('gestao_registrar_venda', JSON.stringify({ canal: 'Feira', itens: [{ sku: 'BB001', preco: 64.9, qtd: antes + 5 }], origem: 'gestao' }));
t('estoque pode ficar negativo (decisão tomada antes)', (await est('BB001')) === -5);

console.log('— Editar / excluir venda');
await rpc('gestao_editar_venda', JSON.stringify({ id: v1, data: '2026-09-18', canal: 'Instagram', cliente: { nome: 'Cliente Editado', tel: '61977776666' }, obs: 'editada' }));
const VE = (await q('select v.data_venda::text d, c.nome canal, v.observacao o, cl.nome cli from vendas v join canais c on c.id=v.canal_id join clientes cl on cl.id=v.cliente_id where v.id=$1', [v1]))[0];
t('edição: data, canal, obs e cliente', VE.d === '2026-09-18' && VE.canal === 'Instagram' && VE.o === 'editada' && VE.cli === 'Cliente Editado', JSON.stringify(VE));
t('edição não mexeu nos itens nem no valor', Number((await q('select valor from vendas where id=$1', [v1]))[0].valor) === 176.72);
// venda do CRM com cashback e follow-up ligados (como no CRM real)
const crm = (await q("select id, cliente_id from vendas where origem='crm' limit 1"))[0];
await db.exec(`insert into cashback(venda_id,cliente_id,valor,data_liberacao,data_validade) values ('${crm.id}','${crm.cliente_id}',5,current_date,current_date+30)`);
await db.exec(`insert into follow_up_regras(chave,descricao,tipo_gatilho) values ('t','t','apos_venda')`);
await db.exec(`insert into follow_up_instancias(regra_id,cliente_id,venda_id,data_prevista) select (select id from follow_up_regras limit 1),'${crm.cliente_id}','${crm.id}',current_date`);
const eC = await est('BB002');
await rpc('gestao_excluir_venda', v1);
t('excluir venda devolve o estoque (BB002 +1)', (await est('BB002')) === eC + 1);
t('excluir venda: sumiu com itens', (await q('select count(*) c from vendas where id=$1', [v1]))[0].c === 0 && (await q('select count(*) c from venda_itens where venda_id=$1', [v1]))[0].c === 0);
await rpc('gestao_excluir_venda', crm.id);
t('excluir venda do CRM limpa cashback e follow-up (sem erro de vínculo)', (await q('select count(*) c from cashback where venda_id=$1', [crm.id]))[0].c === 0 && (await q('select count(*) c from follow_up_instancias where venda_id=$1', [crm.id]))[0].c === 0);
await falha('excluir venda que não existe', () => rpc('gestao_excluir_venda', '00000000-0000-0000-0000-000000000000'), 'não encontrada');

console.log('— Produtos e estoque');
await rpc('gestao_salvar_produto', JSON.stringify({ novo: true, sku: 'tst9', nome: 'PRODUTO TESTE', colecao: 'Teste', categoria: 'Vela', data_fabricacao: '09/2026', validade_meses: 24, preco: 50, qtd: 5 }));
t('produto novo: SKU em maiúsculas e estoque inicial 5', (await est('TST9')) === 5);
await falha('SKU repetido', () => rpc('gestao_salvar_produto', JSON.stringify({ novo: true, sku: 'TST9', nome: 'x' })), 'já existe');
await rpc('gestao_salvar_produto', JSON.stringify({ novo: false, sku: 'TST9', nome: 'PRODUTO TESTE 2', categoria: 'Vela', data_fabricacao: '09/2026', validade_meses: 24, preco: 55, qtd: 8 }));
t('editar produto: nome/preço e quantidade 5→8 (reposição de 3)', (await est('TST9')) === 8 && (await q("select nome,preco::float8 p from produtos where sku='TST9'"))[0].p === 55);
await rpc('gestao_salvar_produto', JSON.stringify({ novo: false, sku: 'TST9', nome: 'PRODUTO TESTE 2', categoria: 'Vela', data_fabricacao: '09/2026', validade_meses: 24, preco: 55, qtd: 6 }));
t('quantidade 8→6 vira ajuste de −2', (await est('TST9')) === 6 && (await q("select quantidade q from movimentos_estoque where sku='TST9' and tipo='ajuste'"))[0].q === -2);
await rpc('gestao_atualizar_fabricacao', 'TST9', '10/2026', 12);
const P = (await q("select data_fabricacao f, data_vencimento::text v, estoque_atual e from produtos where sku='TST9'"))[0];
t('nova fabricação 10/2026 com 12 un: estoque 12 e vencimento pela regra do PRD', P.e === 12 && P.f === '10/2026' && P.v === '2028-10-31', JSON.stringify(P));
await rpc('gestao_atualizar_fabricacao', 'TST9', '11/2026', 12);
t('só mudar a fabricação (mesma quantidade) atualiza a data', (await q("select data_fabricacao f from produtos where sku='TST9'"))[0].f === '11/2026');
await falha('fabricação em formato errado', () => rpc('gestao_atualizar_fabricacao', 'TST9', '2026-10', 1), 'MM/AAAA');
t('excluir produto sem vendas apaga de vez', (await rpc('gestao_excluir_produto', 'TST9')) === 'excluido' && (await est('TST9')) === undefined);
t('excluir produto COM vendas só oculta (histórico preservado)', (await rpc('gestao_excluir_produto', 'BB003')) === 'ocultado' && (await q("select oculto o from produtos where sku='BB003'"))[0].o === true);

// produto oculto (tinha vendas) volta com um novo lote, sem recadastrar
await rpc('gestao_salvar_produto', JSON.stringify({ novo: false, sku: 'BB003', nome: 'CREME HIDRATANTE JASMIM', categoria: 'Hidratante', data_fabricacao: '09/2026', validade_meses: 12, preco: 64.9, qtd: 20 }));
const RE = (await q("select oculto o, estoque_atual e, data_fabricacao f, data_vencimento::text v from produtos where sku='BB003'"))[0];
t('produto oculto reativado com novo lote (visível, estoque 20, fabricação 09/2026, vence 30/09/2027)', RE.o === false && RE.e === 20 && RE.f === '09/2026' && RE.v === '2027-09-30', JSON.stringify(RE));
t('histórico de vendas do produto reativado continua', (await q("select count(*) c from venda_itens where sku='BB003'"))[0].c >= 1);
console.log('— Clientes e canais');
const c1 = await rpc('gestao_salvar_cliente', 'Ana Nova', '(61) 95555-4444', 'ana@x.com');
const c2 = await rpc('gestao_salvar_cliente', 'Ana N.', '61955554444', '');
t('cliente repetido (mesmo telefone) não duplica', c1 === c2);
await falha('excluir cliente com vendas', () => rpc('gestao_excluir_cliente', crm.cliente_id), 'não pode ser excluído');
await rpc('gestao_excluir_cliente', c1);
t('excluir cliente sem vendas', (await q('select count(*) c from clientes where id=$1', [c1]))[0].c === 0);
await rpc('gestao_salvar_canal', 'Loja Nova');
t('canal novo', (await q("select tipo from canais where nome='Loja Nova'"))[0].tipo === 'outro');
await rpc('gestao_renomear_canal', 'Loja Nova', 'Loja Nova 2');
t('renomear canal', (await q("select count(*) c from canais where nome='Loja Nova 2'"))[0].c === 1);
t('remover canal sem vendas apaga', (await rpc('gestao_remover_canal', 'Loja Nova 2')) === 'excluido');
t('remover canal COM vendas só desativa', (await rpc('gestao_remover_canal', 'WhatsApp')) === 'desativado' && (await q("select ativo a from canais where nome='WhatsApp'"))[0].a === false);
await falha('vender num canal desativado', () => rpc('gestao_registrar_venda', JSON.stringify({ canal: 'WhatsApp', itens: [{ sku: 'BB001', preco: 1, qtd: 1 }] })), 'inativo');
await rpc('gestao_salvar_canal', 'whatsapp');
t('recadastrar canal desativado reativa (sem duplicar)', (await q("select count(*) c from canais where lower(nome)='whatsapp' and ativo")).length && (await q("select count(*) c from canais where lower(nome)='whatsapp'"))[0].c === 1);

console.log('— Segurança');
await db.exec('reset role'); await db.exec('set role anon');
await falha('visitante (sem login) NÃO consegue chamar as funções', () => rpc('gestao_canal_id', 'Feira'), 'permission denied');
await db.exec('reset role');
await db.exec('set role authenticated');
t('usuário logado consegue', (await rpc('gestao_canal_id', 'Feira')) !== null);

console.log('— Integridade final');
t('estoque de cada produto = soma dos movimentos', (await q('select count(*) c from produtos p where estoque_atual <> coalesce((select sum(quantidade) from movimentos_estoque m where m.sku=p.sku),0)'))[0].c === 0);
t('nenhum item de venda sem movimento de saída', (await q("select count(*) c from venda_itens i where sku is not null and not exists (select 1 from movimentos_estoque m where m.venda_item_id=i.id)"))[0].c === 0);
console.log(`\n${ok} passaram, ${ko} falharam`);
process.exit(ko ? 1 : 0);
