export async function restoreSession(loadProfile, clearSession) {
  try { return {user:(await loadProfile()).user,error:null}; }
  catch(error) {
    if(error.status===401){clearSession();return {user:null,error:null};}
    return {user:null,error:error.status===429?'Too many requests. Please wait a few minutes, then try again. Your sign-in has been preserved.':'We could not reach the Admin service. Please try again. Your sign-in has been preserved.'};
  }
}
