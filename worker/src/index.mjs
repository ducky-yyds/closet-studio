import { createFlatlayHandler } from '../../server/flatlay-service.mjs';

export default {
  async fetch(request, env) {
    return createFlatlayHandler(env, { requireAccessToken: true })(request);
  }
};
