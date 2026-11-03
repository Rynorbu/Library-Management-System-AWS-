import { config } from '../config.js';

/** Fetch the RDS credentials JSON from AWS Secrets Manager (no passwords in code or env). */
export async function getDbSecret(secretId) {
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: config.awsRegion });
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return JSON.parse(res.SecretString);
}
