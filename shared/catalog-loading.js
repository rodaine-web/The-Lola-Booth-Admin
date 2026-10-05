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
