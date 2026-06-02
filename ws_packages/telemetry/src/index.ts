export type {
  Env,
  OtlpSignalEndpoints,
  ResourceAttrs,
  ResourceOpts,
  SignalEndpointOpts,
} from './resource.js';
export {
  buildOtlpSignalEndpoints,
  buildResource,
  buildResourceAttrs,
  readEnv,
  resolveDeploymentEnv,
  resolveOtlpBase,
  resolveServiceName,
} from './resource.js';
