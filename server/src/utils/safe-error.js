export function safeError(error,config=process.env){
 let message=String(error?.message||'Operation failed');
 for(const [key,value] of Object.entries(config))if(/SECRET|TOKEN|PASSWORD|DATABASE_URL|API_KEY/.test(key)&&value&&value.length>=8)message=message.split(value).join('[redacted]');
 message=message.replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]+|\bwhsec_[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]');
 return {type:error?.name||'Error',code:error?.code||'UNCLASSIFIED',message};
}
