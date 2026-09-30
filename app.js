import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, query, limit } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { pad, numberId, whatsappNumber, safeImage, entryData, chooseNumber } from './domain.js';

const $ = id => document.getElementById(id);
const show = (id, yes) => $(id).classList.toggle('hidden', !yes);
const text = (id, value) => { $(id).textContent = value; };
const statuses = { pending: 'Em revisão', confirmed: 'Resgatado', rejected: 'Recusado / liberado' };
const base = { title: 'Legendários Vale do Teles Pires', prize: 'Prêmio a definir', description: 'O organizador está preparando as informações desta campanha.', image: '', drawAt: '', rules: 'Participação gratuita. Um número por conta Google. A participação depende da confirmação do organizador. Somente números confirmados entram no sorteio. Nenhum pagamento é necessário. O contemplado será contatado pelos dados informados no cadastro.', whatsapp: '', isOpen: false, winner: '' };
const app = initializeApp(window.LEGENDARIOS_FIREBASE);
const auth = getAuth(app), db = getFirestore(app), campaignRef = doc(db, 'public', 'campaign');
const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
let campaign = { ...base }, campaignExists = false, connected = false, user = null, admin = false, selected = null, ownEntry = null, entries = [], tickets = new Map(), photo = '', editVersion = null, currentPage = 'participar';
let campaignStop, numbersStop, privateStop, mineStop, pendingAction = null, busy = false;

function feedback(id, message = '', error = false) { text(id, message); $(id).classList.toggle('error', error); }
function errorMessage(e) {
  const code = e?.code || '';
  if (code.includes('permission-denied')) return 'Ação não autorizada. Confira a conta ADM, as regras do banco e se as inscrições estão abertas.';
  if (code.includes('resource-exhausted')) return 'O limite gratuito diário foi atingido. Tente novamente depois da renovação da cota.';
  if (code.includes('popup-blocked')) return 'Seu navegador bloqueou o login. Permita a janela de acesso e clique em Entrar novamente.';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return 'O login não foi concluído. Clique em Entrar para tentar novamente.';
  if (code.includes('unauthorized-domain')) return 'Este endereço precisa ser autorizado no Firebase Authentication. Use o domínio do GitHub Pages configurado.';
  if (code.includes('network') || code.includes('unavailable')) return 'Sem conexão com o serviço. Confira sua internet e tente novamente.';
  return e?.message || 'Não foi possível concluir. Tente novamente.';
}
function openNow() { return connected && campaignExists && campaign.isOpen && !campaign.winner; }
function setPage(page) {
  if (!['participar','descricao','adm'].includes(page)) page = 'participar';
  currentPage = page;
  for (const p of ['participar','descricao','adm']) show(p, p === page);
  document.querySelectorAll('main > nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  history.replaceState(null, '', '#' + page); renderIdentity();
}
document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));
document.querySelectorAll('[data-admin]').forEach(b => b.addEventListener('click', () => {
  for (const id of ['revisao','editar','registrar','resultado']) show(id, id === b.dataset.admin);
  document.querySelectorAll('[data-admin]').forEach(x => x.classList.toggle('active', x === b));
}));
function dateText(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', timeZoneName: 'short' }) : 'Data a definir pelo organizador'; }
function renderCampaign() {
  document.querySelectorAll('.campaign-title').forEach(el => el.textContent = campaign.title);
  text('campaignSummary', campaign.winner ? 'Sorteio concluído. Consulte o resultado abaixo.' : openNow() ? 'Escolha gratuitamente e aguarde a confirmação do organizador.' : 'Inscrições em preparação ou encerradas. Consulte a descrição.');
  text('campaignBadge', campaign.winner ? 'Sorteio concluído' : openNow() ? 'Inscrições abertas · R$ 0,00' : 'Inscrições fechadas');
  text('prizeTitle', campaign.prize); text('descriptionText', campaign.description); text('rulesText', campaign.rules); text('dateText', 'Sorteio: ' + dateText(campaign.drawAt));
  let image = ''; try { image = safeImage(campaign.image); } catch {}
  $('prizeImage').src = image || ''; show('prizeImage', !!image);
  show('contactOrganizer', !!campaign.whatsapp); show('myWhatsapp', !!campaign.whatsapp && !!ownEntry);
  show('publicWinner', !!campaign.winner); $('publicWinner').replaceChildren();
  if (campaign.winner) { const t = document.createElement('span'); t.textContent = 'Número contemplado'; const n = document.createElement('strong'); n.textContent = campaign.winner; $('publicWinner').append(t,n); }
  text('drawInfo', campaign.winner ? `Resultado registrado: ${campaign.winner}\nO sorteio não pode ser refeito.` : `Data programada: ${dateText(campaign.drawAt)}\nNúmeros em revisão não participam.`);
  $('drawButton').disabled = busy || !openNow() || !!campaign.winner || ![...tickets.values()].some(t => t.status === 'confirmed');
  if (editVersion === null) fillEditor();
  renderGrid(); renderIdentity(); renderRows();
}
function fillEditor() {
  $('editTitle').value = campaign.title; $('editPrize').value = campaign.prize; $('editDescription').value = campaign.description; $('editRules').value = campaign.rules; $('editWhatsapp').value = campaign.whatsapp; $('editOpen').checked = campaign.isOpen;
  photo = campaign.image.startsWith('data:') ? campaign.image : ''; $('editImage').value = photo ? '' : campaign.image;
  $('editDate').value = campaign.drawAt ? new Date(new Date(campaign.drawAt).getTime() - new Date(campaign.drawAt).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  $('photoPreview').src = campaign.image || ''; show('photoPreview', !!campaign.image);
  editVersion = campaign.updatedAt?.toMillis?.() || 0;
}
$('timezoneLabel').textContent = 'Preencha no horário do seu dispositivo: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '. A página pública exibe o horário de Cuiabá.';
function renderGrid() {
  if (selected && tickets.has(selected)) selected = null;
  const confirmed = [...tickets.values()].filter(t => t.status === 'confirmed').length;
  const pending = [...tickets.values()].filter(t => t.status === 'pending').length;
  text('countConfirmed', connected ? confirmed : '—'); text('countPending', connected ? pending : '—'); text('countAvailable', connected ? 100-tickets.size : '—');
  text('adminCounts', `${confirmed} resgatados · ${pending} em revisão · ${100-tickets.size} disponíveis`);
  $('numberGrid').replaceChildren();
  for (let i=1;i<=100;i++) {
    const id=pad(i), occupied=tickets.get(id), b=document.createElement('button'); b.type='button'; b.className='number '+(occupied?.status || '')+(selected === id?' selected':''); b.textContent=id;
    b.disabled=busy || !openNow() || !!occupied || !!(ownEntry && ownEntry.status!=='rejected');
    b.setAttribute('aria-label', `Número ${id}, ${occupied ? statuses[occupied.status] : 'disponível'}`); b.setAttribute('aria-pressed', String(selected === id));
    b.onclick=()=>{selected=id;renderGrid();}; $('numberGrid').append(b);
  }
  text('selectedNumber', selected || '—'); $('reserveButton').disabled=busy || !user || !user.emailVerified || !selected || !openNow() || !!(ownEntry && ownEntry.status!=='rejected');
}
function contactText(e) { return `Número: ${e.number}\nNome: ${e.name}\nTelefone: ${e.phone}\nE-mail: ${e.email}\nCidade: ${e.city} / ${e.uf}\nEndereço: ${e.address || 'Não informado'}\nCEP: ${e.cep || 'Não informado'}\nSituação: ${statuses[e.status]}`; }
function renderIdentity() {
  text('identity', user ? `Conta: ${user.email}${admin ? ' · Administrador autorizado' : ''}` : '');
  show('logout', !!user); show('loginCard', !user); show('entryForm', !!user && (!ownEntry || ownEntry.status==='rejected')); show('myEntry', !!ownEntry);
  show('adminGate', !admin); show('adminContent', admin); show('adminLogin', !user || !admin); text('adminDenied', user && !admin ? 'Esta conta não tem permissão ADM. Entre com a conta autorizada.' : '');
  if (ownEntry) text('myEntryText', `${statuses[ownEntry.status]}\nNúmero ${ownEntry.number}\n${ownEntry.name}\n${ownEntry.status === 'pending' ? 'Seu pedido foi salvo. Aguarde a revisão do organizador.' : ownEntry.status==='confirmed' ? 'Seu número foi resgatado e está confirmado.' : 'O número foi liberado. Você pode escolher outro ou falar com o organizador.'}`);
  if (user) { $('participantEmail').value=user.email || ''; if (!$('fullName').value) $('fullName').value=user.displayName || ''; }
  show('myWhatsapp', !!campaign.whatsapp && !!ownEntry); renderGrid();
}
function connectPublic() {
  campaignStop?.(); numbersStop?.();
  campaignStop=onSnapshot(campaignRef, snap=>{campaignExists=snap.exists();campaign={...base,...(snap.data()||{})};connected=true;feedback('globalStatus', campaignExists ? '' : 'O ADM precisa salvar a descrição e abrir as inscrições antes de receber participantes.');renderCampaign();}, e=>{connected=false;feedback('globalStatus',errorMessage(e),true);renderGrid();});
  numbersStop=onSnapshot(query(collection(db,'numbers'),limit(100)), snap=>{tickets=new Map(snap.docs.map(d=>[d.id,d.data()]));renderCampaign();},e=>{connected=false;feedback('globalStatus',errorMessage(e),true);renderGrid();});
}
async function login(button) {
  button.disabled=true;feedback('globalStatus','Abrindo acesso Google…');
  try { await signInWithPopup(auth,provider);feedback('globalStatus',''); } catch(e) {feedback('globalStatus',errorMessage(e),true);} finally {button.disabled=false;}
}
$('googleLogin').onclick=()=>login($('googleLogin')); $('adminLogin').onclick=()=>login($('adminLogin')); $('logout').onclick=async()=>{await signOut(auth);$('fullName').value=''; $('entryForm').reset();};
onAuthStateChanged(auth,async account=>{
  user=account;admin=false;ownEntry=null;entries=[];selected=null;mineStop?.();privateStop?.();renderIdentity();renderRows();
  if(!account || !account.emailVerified) return;
  mineStop=onSnapshot(doc(db,'requests',account.uid),snap=>{if(user?.uid!==account.uid)return;ownEntry=snap.exists()?{id:snap.id,...snap.data()}:null;renderIdentity();},e=>feedback('entryStatus',errorMessage(e),true));
  try {await getDoc(doc(db,'adminAccess','status')); if(user?.uid!==account.uid)return;admin=true;editVersion=null;fillEditor();renderIdentity();privateStop=onSnapshot(collection(db,'requests'),snap=>{if(user?.uid!==account.uid||!admin)return;entries=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>Number(a.number)-Number(b.number));renderRows();},e=>feedback('reviewStatus',errorMessage(e),true));} catch(e){if(!String(e.code).includes('permission-denied'))feedback('globalStatus',errorMessage(e),true);}
});
async function run(button,status,action) { if(busy)return;busy=true;button.disabled=true;renderGrid();feedback(status,'Salvando…');try{await action();}catch(e){feedback(status,errorMessage(e),true);}finally{busy=false;button.disabled=false;renderCampaign();}}
async function reserve(e,id,confirmed=false) {
  const r=doc(db,'requests',id), t=doc(db,'numbers',e.number);
  await runTransaction(db,async tx=>{
    const [cs,ts,rs]=await Promise.all([tx.get(campaignRef),tx.get(t),tx.get(r)]);
    if(!cs.exists()||!cs.data().isOpen||cs.data().winner)throw new Error('As inscrições estão fechadas.');
    if(ts.exists())throw new Error('Este número acabou de ser solicitado por outra pessoa. Escolha outro.');
    if(rs.exists()&&rs.data().status!=='rejected')throw new Error('Esta conta já tem uma solicitação.');
    const status=confirmed?'confirmed':'pending';
    tx.set(r,{...e,status,createdAt:serverTimestamp()});tx.set(t,{status,claim:id});
  });
}
$('entryForm').onsubmit=e=>{e.preventDefault();run($('reserveButton'),'entryStatus',async()=>{
  if(!user?.emailVerified)throw new Error('Entre com sua conta Google.');
  const p=entryData({name:$('fullName').value,phone:$('phone').value,email:user.email,city:$('city').value,uf:$('uf').value,address:$('address').value,cep:$('cep').value,number:selected});await reserve(p,user.uid);selected=null;feedback('entryStatus','Pedido salvo. Aguarde a confirmação do ADM.');
});};
function renderRows() {
  $('entryRows').replaceChildren(); const filter=$('filterStatus').value;
  const list=entries.filter(e=>filter==='all'||e.status===filter);show('emptyRows',!list.length);
  for(const e of list){const tr=document.createElement('tr');
    for(const value of [e.number,e.name,`${e.phone}\n${e.email}`]){const td=document.createElement('td');td.className='prewrap';td.textContent=value;tr.append(td);}
    const st=document.createElement('td'),badge=document.createElement('span');badge.className='status '+e.status;badge.textContent=statuses[e.status];st.append(badge);tr.append(st);
    const td=document.createElement('td'),a=document.createElement('div');a.className='actions';
    const details=document.createElement('button');details.className='secondary';details.textContent='Ver cadastro';details.onclick=()=>{text('detailText',contactText(e));$('detailsDialog').showModal();};a.append(details);
    if(e.status==='pending'){const b=document.createElement('button');b.className='secondary';b.textContent='Confirmar número';b.disabled=busy||!openNow();b.onclick=()=>askReview(e,'confirmed');a.append(b);}
    if(e.status!=='rejected'){const b=document.createElement('button');b.className='text-button';b.textContent=e.status==='pending'?'Recusar e liberar':'Liberar número';b.disabled=busy||!openNow();b.onclick=()=>askReview(e,'rejected');a.append(b);}
    td.append(a);tr.append(td);$('entryRows').append(tr);
  }
}
$('filterStatus').onchange=renderRows; $('closeDetails').onclick=()=>$('detailsDialog').close();
function askReview(e,status){pendingAction=()=>review(e,status);text('reviewTitle',status==='confirmed'?'Confirmar número?':'Liberar número?');text('reviewText',status==='confirmed'?`O número ${e.number} de ${e.name} será marcado como resgatado.`:`O número ${e.number} de ${e.name} ficará disponível para uma nova solicitação.`);$('reviewDialog').showModal();}
async function review(e,status){await run($('refreshAdmin'),'reviewStatus',async()=>{
  await runTransaction(db,async tx=>{const r=doc(db,'requests',e.id),t=doc(db,'numbers',e.number);const [rs,ts,cs]=await Promise.all([tx.get(r),tx.get(t),tx.get(campaignRef)]);
    if(!cs.data()?.isOpen||cs.data()?.winner)throw new Error('Reabra as inscrições para revisar números. O resultado concluído não permite alterações.');
    if(!rs.exists()||!ts.exists()||ts.data().claim!==e.id||rs.data().status!==e.status)throw new Error('O pedido mudou. Atualize o painel.');
    tx.update(r,{status,reviewedAt:serverTimestamp()});if(status==='confirmed')tx.update(t,{status});else tx.delete(t);
  });feedback('reviewStatus',status==='confirmed'?`Número ${e.number} resgatado com sucesso.`:`Número ${e.number} liberado.`);
});}
$('reviewNo').onclick=()=>{$('reviewDialog').close();pendingAction=null;}; $('reviewDialog').addEventListener('cancel',()=>pendingAction=null);
$('reviewYes').onclick=()=>{const action=pendingAction;pendingAction=null;$('reviewDialog').close();action?.();};
$('manualForm').onsubmit=e=>{e.preventDefault();run($('manualSubmit'),'manualStatus',async()=>{if(!admin)throw new Error('Acesso ADM necessário.');const p=entryData({name:$('manualName').value,phone:$('manualPhone').value,email:$('manualEmail').value,city:$('manualCity').value,uf:$('manualUf').value,number:$('manualNumber').value});await reserve(p,'manual-'+crypto.randomUUID(),true);$('manualForm').reset();feedback('manualStatus',`Número ${p.number} confirmado e salvo.`);});};
$('photoFile').onchange=async()=>{const f=$('photoFile').files[0];if(!f)return;try{if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>450*1024)throw new Error('Escolha JPG, PNG ou WebP de até 450 KB.');photo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível ler a foto.'));reader.readAsDataURL(f);});photo=safeImage(photo);$('editImage').value='';$('photoPreview').src=photo;show('photoPreview',true);feedback('saveStatus','Foto pronta. Clique em Salvar para publicar.');}catch(e){feedback('saveStatus',errorMessage(e),true);$('photoFile').value='';}};
$('editImage').oninput=()=>{if($('editImage').value.trim())photo='';}; $('removePhoto').onclick=()=>{photo='';$('photoFile').value='';$('editImage').value='';show('photoPreview',false);};
$('campaignForm').onsubmit=e=>{e.preventDefault();run($('saveCampaign'),'saveStatus',async()=>{
  if(!admin)throw new Error('Acesso ADM necessário.');const c={title:$('editTitle').value.trim(),prize:$('editPrize').value.trim(),description:$('editDescription').value.trim(),image:safeImage($('editImage').value.trim()||photo),drawAt:$('editDate').value?new Date($('editDate').value).toISOString():'',rules:$('editRules').value.trim(),whatsapp:whatsappNumber($('editWhatsapp').value),isOpen:$('editOpen').checked,winner:campaign.winner||''};
  if(c.title.length<3||c.prize.length<3||!c.description||!c.rules)throw new Error('Preencha nome, prêmio, descrição e regras.');
  if(c.winner&&c.isOpen)throw new Error('Um sorteio concluído não permite reabrir inscrições.');
  await runTransaction(db,async tx=>{const s=await tx.get(campaignRef);if((s.data()?.updatedAt?.toMillis?.()||0)!==editVersion)throw new Error('A descrição mudou em outra sessão. Atualize o painel antes de salvar.');tx.set(campaignRef,{...c,updatedAt:serverTimestamp()});});
  // Aguarde a leitura do registro confirmado antes de repor os campos do editor.
  // O aviso de sucesso pode chegar antes do evento do listener em tempo real.
  const saved=await getDoc(campaignRef);
  campaignExists=saved.exists();campaign={...base,...(saved.data()||{})};
  editVersion=null;fillEditor();feedback('saveStatus','Descrição e configurações publicadas com sucesso.');
});};
async function refreshAll(){await run($('refresh'),'globalStatus',async()=>{const [c,t]=await Promise.all([getDoc(campaignRef),getDocs(query(collection(db,'numbers'),limit(100)))]);campaignExists=c.exists();campaign={...base,...(c.data()||{})};tickets=new Map(t.docs.map(d=>[d.id,d.data()]));connected=true;editVersion=null;if(admin)fillEditor();renderCampaign();feedback('globalStatus',campaignExists?'Disponibilidade atualizada.':'Entre na Área ADM para configurar a campanha.');});}
$('refresh').onclick=refreshAll;$('refreshAdmin').onclick=refreshAll;
function whatsapp(message){try{const n=whatsappNumber(campaign.whatsapp);if(n)window.open('https://wa.me/'+n+'?text='+encodeURIComponent(message),'_blank','noopener,noreferrer');}catch(e){feedback('globalStatus',errorMessage(e),true);}}
$('contactOrganizer').onclick=()=>whatsapp(`Olá! Gostaria de informações sobre ${campaign.title}.`);$('myWhatsapp').onclick=()=>whatsapp(`Olá! Sou ${ownEntry?.name}. Meu pedido de participação gratuita em ${campaign.title} é o número ${ownEntry?.number}. Gostaria de falar sobre meu cadastro.`);
$('drawButton').onclick=()=>{pendingAction=draw;text('reviewTitle','Encerrar e sortear?');text('reviewText','As inscrições serão encerradas. Somente números resgatados participarão. O resultado será permanente.');$('reviewDialog').showModal();};
async function draw(){await run($('drawButton'),'drawStatus',async()=>{
  if(!admin)throw new Error('Acesso ADM necessário.');if(campaign.drawAt&&Date.now()<Date.parse(campaign.drawAt))throw new Error('Aguarde a data e o horário programados.');
  const snapshot=await getDocs(collection(db,'numbers')),candidates=snapshot.docs.filter(d=>d.data().status==='confirmed').map(d=>d.id).sort();const winner=chooseNumber(candidates);
  await runTransaction(db,async tx=>{const c=await tx.get(campaignRef);const all=await Promise.all(Array.from({length:100},(_,i)=>tx.get(doc(db,'numbers',pad(i+1)))));if(!c.data()?.isOpen||c.data()?.winner)throw new Error('Inscrições encerradas ou sorteio já realizado.');if(c.data().drawAt&&Date.now()<Date.parse(c.data().drawAt))throw new Error('Aguarde o horário programado.');const now=all.filter(s=>s.exists()&&s.data().status==='confirmed').map(s=>s.id).sort();if(JSON.stringify(now)!==JSON.stringify(candidates))throw new Error('A lista de números mudou. Atualize e inicie o sorteio novamente.');tx.update(campaignRef,{winner,isOpen:false,updatedAt:serverTimestamp()});});feedback('drawStatus',`Resultado registrado: número ${winner}.`);
});}
$('exportPrivate').onclick=()=>{if(!admin)return;const data=JSON.stringify({exportedAt:new Date().toISOString(),campaign,entries},null,2);const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.href=url;a.download='backup-PRIVADO-participantes-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('reviewStatus','Backup privado baixado. Guarde em local protegido e não envie ao repositório público do GitHub.');};
window.addEventListener('hashchange',()=>setPage(location.hash.slice(1)));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)connectPublic();});
setPage(location.hash.slice(1));renderGrid();connectPublic();
