// Catalog lists follow the API's 100-record page limit.
export async function loadCatalog(get, resource) {
  const rows = [];
  let page = 1;
  while (true) {
    const response = await get(`/${resource}?pageSize=100&page=${page}`);
    const data = Array.isArray(response) ? response : response?.data;
    if (!Array.isArray(data)) throw new Error(`Unable to read the ${resource} catalog.`);
    rows.push(...data);
    const total = Number(response?.pagination?.total);
    if (Array.isArray(response) || data.length === 0 || (Number.isFinite(total) ? rows.length >= total : data.length < 100)) return rows;
    page += 1;
  }
}

// Commercial editors use published prices; Catalog screens keep editing draft rows.
export async function loadProposalCatalog(get,resource){
 if(['packages','addons'].includes(resource)){
  try{return (await get('/pricing/current'))[resource];}
  catch(error){if(error.status!==404)throw error;}
 }
 return loadCatalog(get,resource);
}
