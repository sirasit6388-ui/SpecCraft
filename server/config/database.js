export function getDatabaseConfig(env = process.env) {
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'pc_builder',
    usdToThbRate: normalizeExchangeRate(env.USD_TO_THB_RATE),
    mysqlBin: env.MYSQL_BIN || 'C:\\Program Files\\MySQL\\MySQL Server 9.7\\bin\\mysql.exe'
  };
}

function normalizeExchangeRate(value) {
  const rate = Number(value || 36.5);
  return Number.isFinite(rate) && rate > 0 ? rate : 36.5;
}
