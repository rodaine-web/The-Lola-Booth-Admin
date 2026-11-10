// Production execution is restricted to the explicitly reviewed release script.
export function approvedRedesignEnvironment(approval){
 return ['staging','test'].includes(process.env.APP_ENV)||(process.env.APP_ENV==='production'&&approval==='LOLA_REDESIGN_OWNER_APPROVED_2026_11_10');
}
