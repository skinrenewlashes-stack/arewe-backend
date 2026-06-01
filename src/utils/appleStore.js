const {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Type,
} = require('@apple/app-store-server-library');

const APPLE_ROOT_CA_G3_BASE64 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';

const getAppleEnvironment = () => {
  const rawEnvironment = (process.env.APPLE_ENVIRONMENT || 'sandbox').toLowerCase();

  if (rawEnvironment === 'production') {
    return Environment.PRODUCTION;
  }

  if (rawEnvironment === 'sandbox') {
    return Environment.SANDBOX;
  }

  throw new Error('APPLE_ENVIRONMENT must be either sandbox or production.');
};

const getRequiredEnv = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
};

const getApplePrivateKey = () => getRequiredEnv('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');

const getAppAppleId = (environment) => {
  if (environment !== Environment.PRODUCTION) {
    return undefined;
  }

  const appAppleId = Number(process.env.APPLE_APP_APPLE_ID);

  if (!Number.isFinite(appAppleId)) {
    throw new Error('APPLE_APP_APPLE_ID is required for production Apple transaction verification.');
  }

  return appAppleId;
};

const createVerifier = () => {
  const environment = getAppleEnvironment();
  const bundleId = getRequiredEnv('APPLE_BUNDLE_ID');
  const appAppleId = getAppAppleId(environment);
  const appleRootCertificates = [Buffer.from(APPLE_ROOT_CA_G3_BASE64, 'base64')];

  return new SignedDataVerifier(
    appleRootCertificates,
    true,
    environment,
    bundleId,
    appAppleId
  );
};

const createApiClient = () => new AppStoreServerAPIClient(
  getApplePrivateKey(),
  getRequiredEnv('APPLE_KEY_ID'),
  getRequiredEnv('APPLE_ISSUER_ID'),
  getRequiredEnv('APPLE_BUNDLE_ID'),
  getAppleEnvironment()
);

const getStackPreview = (err) => {
  if (!err?.stack) {
    return undefined;
  }

  return err.stack.split('\n').slice(0, 6).join('\n');
};

const summarizeAppleError = (err) => {
  const cause = err?.cause;

  return {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    status: err?.status,
    statusCode: err?.statusCode || err?.response?.status,
    stack: getStackPreview(err),
    cause: cause ? {
      name: cause.name,
      message: cause.message,
      code: cause.code,
      status: cause.status,
      statusCode: cause.statusCode || cause.response?.status,
      stack: getStackPreview(cause),
    } : undefined,
    appleResponse: {
      body: err?.responseBody || err?.response?.body || err?.body,
      data: err?.response?.data,
      errorCode: err?.apiError,
      errorMessage: err?.apiErrorMessage,
    },
  };
};

const withAppleStep = async (step, fn) => {
  try {
    return await fn();
  } catch (err) {
    err.appleVerificationStep = step;
    err.appleDiagnostics = summarizeAppleError(err);
    throw err;
  }
};

const assertValidTransaction = ({ transaction, expectedProductId, expectedTransactionId }) => {
  const expectedBundleId = getRequiredEnv('APPLE_BUNDLE_ID');

  if (transaction.transactionId !== expectedTransactionId) {
    throw new Error('Apple transaction ID mismatch.');
  }

  if (transaction.productId !== expectedProductId) {
    throw new Error('Apple product ID mismatch.');
  }

  if (transaction.bundleId !== expectedBundleId) {
    throw new Error('Apple bundle ID mismatch.');
  }

  if (transaction.revocationDate || transaction.revocationReason !== undefined) {
    throw new Error('Apple transaction has been revoked.');
  }

  if (transaction.type && transaction.type !== Type.CONSUMABLE) {
    throw new Error('Apple transaction is not a consumable purchase.');
  }
};

const verifyAppleTransaction = async ({ signedTransactionInfo, transactionId, productId }) => {
  if (!signedTransactionInfo || !transactionId || !productId) {
    throw new Error('signedTransactionInfo, transactionId, and productId are required.');
  }

  const verifier = await withAppleStep('create_verifier', () => createVerifier());
  const decodedTransaction = await withAppleStep('verify_client_signed_transaction', () =>
    verifier.verifyAndDecodeTransaction(signedTransactionInfo)
  );

  await withAppleStep('validate_client_transaction_fields', async () => assertValidTransaction({
    transaction: decodedTransaction,
    expectedProductId: productId,
    expectedTransactionId: transactionId,
  }));

  const apiClient = await withAppleStep('create_api_client', () => createApiClient());
  const transactionInfoResponse = await withAppleStep('fetch_transaction_info_from_apple', () =>
    apiClient.getTransactionInfo(transactionId)
  );

  if (!transactionInfoResponse.signedTransactionInfo) {
    await withAppleStep('validate_apple_transaction_lookup_response', async () => {
      throw new Error('Apple transaction lookup did not return signed transaction info.');
    });
  }

  const serverTransaction = await withAppleStep(
    'verify_server_signed_transaction',
    () => verifier.verifyAndDecodeTransaction(transactionInfoResponse.signedTransactionInfo)
  );

  await withAppleStep('validate_server_transaction_fields', async () => assertValidTransaction({
    transaction: serverTransaction,
    expectedProductId: productId,
    expectedTransactionId: transactionId,
  }));

  return {
    transaction: serverTransaction,
    signedTransactionInfo: transactionInfoResponse.signedTransactionInfo,
  };
};

module.exports = {
  summarizeAppleError,
  verifyAppleTransaction,
};
