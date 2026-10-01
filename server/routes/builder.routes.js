import { createBuildRecommendation } from '../services/builder.service.js';
import { sendJson } from '../utils/api-response.js';
import { readJsonBody } from '../utils/read-json-body.js';

export function createBuilderRoutes(options = {}) {
  const recommendBuild = options.recommendBuild || createBuildRecommendation;

  return async function builderRoutes(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method !== 'POST' || requestUrl.pathname !== '/api/build/recommend') {
      return false;
    }

    try {
      const body = await readJsonBody(request);
      const build = await recommendBuild({
        mode: body.mode,
        budget: body.budget,
        cpuBrand: body.cpuBrand,
        includeMonitor: body.includeMonitor === true
      });

      sendJson(response, 200, { build });
    } catch (error) {
      sendJson(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, {
        error: 'Cannot recommend build',
        message: error.message
      });
    }

    return true;
  };
}
