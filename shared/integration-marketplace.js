export const integrationCategories = [
 {id:'payments-accounting',name:'Payments & Accounting',description:'Process payments and sync your financial data.',includes:['payments','accounting'],icon:'payments'},
 {id:'marketing',name:'Marketing & Lead Tracking',description:'Grow your audience and track your results.',includes:['marketing'],icon:'marketing'},
 {id:'booth',name:'Booth Software & Event Experience',description:'Connect your booth software to sync events, photos, and guest experiences.',includes:['booth'],icon:'booth'},
 {id:'communication',name:'Communications & Productivity',description:'Streamline your team’s communication and productivity.',includes:['communication'],icon:'communication'},
 {id:'automation',name:'Automation & CRM',description:'Automate your workflows and grow your customer relationships.',includes:['automation'],icon:'automation'},
 {id:'website',name:'Website & Content',description:'Connect your website, content tools, and analytics.',includes:['website'],icon:'website'}
];
export const integrationFilters=[['all','All'],['recommended','Recommended'],['connected','Connected'],['payments','Payments'],['booth','Photo Booth Apps'],['marketing','Marketing'],['accounting','Accounting'],['communication','Communication'],['website','Website'],['automation','Automation']];
export function marketplaceState(definition, evidence={}) {
 if(definition.implementationStatus!=='supported')return {status:'COMING_SOON',label:'Coming Soon',health:'unknown'};
 const state=String(evidence.status||'NOT_CONNECTED').toUpperCase();
 if(['ERROR','MISCONFIGURED','EXPIRED','DEGRADED'].includes(state))return {status:state,label:state==='EXPIRED'?'Authorization expired':state==='DEGRADED'?'Needs attention':'Error',health:'attention'};
 if(state==='DISABLED'||state==='DISCONNECTED')return {status:'DISABLED',label:'Disabled',health:'unknown'};
 if(state==='CONNECTED'&&evidence.verified)return {status:'CONNECTED',label:'Connected',health:'verified'};
 if(['READY','LIVE_READY','TEST_READY','CONNECTED','PENDING_VERIFICATION'].includes(state))return {status:'CONFIGURED',label:'Configured · unverified',health:'unknown'};
 if(['PENDING_APPROVAL','AWAITING_APPROVAL','NOT_CONFIGURED','SETUP_REQUIRED'].includes(state))return {status:'SETUP_REQUIRED',label:state.includes('APPROVAL')?'Approval required':'Needs Setup',health:'unknown'};
 return {status:'AVAILABLE',label:'Available',health:'unknown'};
}
export function filterIntegrations(items,search='',filter='all') {
 const term=search.trim().toLowerCase();
 return items.filter(item=>(filter==='all'||filter==='recommended'&&item.recommended||filter==='connected'&&item.state.status==='CONNECTED'||item.categories.includes(filter))&&`${item.name} ${item.description} ${item.categories.join(' ')} ${integrationCategories.filter(category=>category.includes.some(id=>item.categories.includes(id))).map(category=>category.name).join(' ')} ${integrationFilters.filter(([id])=>item.categories.includes(id)).map(([,label])=>label).join(' ')}`.toLowerCase().includes(term));
}
export function marketplaceMetrics(items){return {connected:items.filter(i=>i.state.status==='CONNECTED').length,available:items.filter(i=>i.implementationStatus==='supported'&&!['DISABLED','COMING_SOON'].includes(i.state.status)).length,attention:items.filter(i=>i.state.health==='attention'||i.state.status==='SETUP_REQUIRED').length,issues:items.filter(i=>i.state.health==='attention').length};}
