// Run on the dedicated demo host with service connection JSON on stdin.
// The policy module is bundled by the launch helper; no credentials are logged.
import { readFile } from 'node:fs/promises';
let input='';for await(const c of process.stdin)input+=c;
const connection=JSON.parse(input);
const policy=JSON.parse(await readFile(process.argv[2],'utf8'));
const cases=[
 {id:'layout-partial',tenant:'STORE_A',q:'매장의 구조는',facts:['1층','2층','A-04','C-02','확인.*(?:없|어렵)|알 수 없|확정.*없'],forbidden:['총\\s*2층(?:입니다|으로 구성)']},
 {id:'floors-lower-bound',tenant:'STORE_A',q:'매장의 총 층수는',facts:['1층','2층','총|전체','확인.*(?:없|어렵)|알 수 없|확정.*없'],forbidden:['총\\s*2층(?:입니다|으로 구성)']},
 {id:'invented-stairs',tenant:'STORE_A',q:'계단이 매장 어디에 있나요?',refuse:true},
 {id:'invented-third-floor',tenant:'STORE_A',q:'3층에는 어떤 상품이 있나요?',refuse:true},
 {id:'count-colloquial',tenant:'STORE_A',q:'상품의 갯수는',facts:['3종|3가지|세 가지']},
 {id:'count-varieties',tenant:'STORE_A',q:'상품의 가짓수는',facts:['3종|3가지|세 가지']},
 {id:'catalog',tenant:'STORE_A',q:'상품의 종류가 뭐가 있나',facts:['멀티탭','건전지','리빙박스']},
 {id:'budget',tenant:'STORE_A',q:'5천 원 이하 상품 이름, 가격과 위치를 각각 알려주세요.',facts:['멀티탭','건전지','5,?000','3,?000','A-04']},
 {id:'compare',tenant:'STORE_A',q:'멀티탭과 리빙박스의 가격과 위치를 비교해 주세요.',facts:['5,?000','6,?000','A-04','C-02']},
 {id:'stock',tenant:'STORE_A',q:'AA 건전지 8입 재고와 가격을 알려주세요.',facts:['42','3,?000'],quality:['자료|등록']},
 {id:'return-a',tenant:'STORE_A',q:'8일 전에 구매한 미사용 멀티탭인데 영수증이 있어요. 교환할 수 있나요?',facts:['7일','어렵|지났|초과|벗어|불가|불가능']},
 {id:'return-b',tenant:'STORE_B',q:'8일 전에 구매한 미사용 상품과 영수증이 있습니다. 교환 가능한가요?',facts:['14일','가능']},
 {id:'hours',tenant:'STORE_A',q:'매일 몇 시에 열고 몇 시에 닫나요?',facts:['10시|10:00','22시|22:00|오후 10']},
 {id:'unknown-product',tenant:'STORE_A',q:'갓김치 종류와 가격을 알려주세요.',refuse:true},
 {id:'unknown-restock',tenant:'STORE_A',q:'품절 상품의 다음 입고일을 알 수 있나요?',refuse:true},
 {id:'tenant-isolation',tenant:'STORE_B',q:'상품의 종류가 뭐가 있나',refuse:true},
];
for(const mode of ['baseline','candidate']){
 for(const c of cases){
  const r=await fetch('http://app:11000/knowledge/answers',{method:'POST',headers:{'content-type':'application/json',appkey:connection[`AI_SERVER_APPKEY_${c.tenant}`]},body:JSON.stringify({query:c.q,limit:5,strict:true,includeSources:true,...(mode==='baseline'?{answerStyle:'concise',maxTokens:512,temperature:0.1}:policy)}),signal:AbortSignal.timeout(60000)});
  const d=await r.json();const answer=d.answer||'';
  const factual=r.ok&&(c.refuse?d.answerable===false&&(d.sources||[]).length===0:d.answerable===true&&(d.sources||[]).length>0&&c.facts.every(f=>new RegExp(f).test(answer)));
  const quality=factual&&(c.quality||[]).every(f=>new RegExp(f).test(answer))&&!(c.forbidden||[]).some(f=>new RegExp(f).test(answer));
  console.log(JSON.stringify({mode,id:c.id,query:c.q,tenant:c.tenant,status:r.status,factual,quality,answer,answerable:d.answerable,sources:(d.sources||[]).map(s=>s.fileName),latencyMs:d.latencyMs,requestId:d.requestId,answerStatus:d.answerStatus}));
 }
}
