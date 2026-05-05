const { google } = require('googleapis');

const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const getGooglePlayServiceAccount = () => {
  const rawCredentials = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

  if (!rawCredentials) {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured.');
  }

  try {
    return JSON.parse(rawCredentials);
  } catch (err) {
    console.error('Failed to parse Google Play service account JSON:', {
      message: err.message,
    });
    throw new Error('Google Play service account credentials are invalid.');
  }
};

const createGooglePlayAuth = () => {
  const credentials = getGooglePlayServiceAccount();

  return new google.auth.GoogleAuth({
    credentials,
    scopes: [ANDROID_PUBLISHER_SCOPE],
  });
};

const verifyGooglePlayProductPurchase = async ({ packageName, productId, purchaseToken }) => {
  if (!packageName || !productId || !purchaseToken) {
    throw new Error('packageName, productId, and purchaseToken are required.');
  }

  const auth = createGooglePlayAuth();
  const androidpublisher = google.androidpublisher('v3');

  try {
    const response = await androidpublisher.purchases.products.get({
      packageName,
      productId,
      token: purchaseToken,
      auth,
    });

    return response.data;
  } catch (err) {
    console.error('Google Play product purchase verification failed:', {
      message: err.message,
      status: err.response?.status,
      code: err.code,
      productId,
      packageName,
    });
    throw new Error('Google Play purchase verification failed.');
  }
};

const consumeGooglePlayProductPurchase = async ({ packageName, productId, purchaseToken }) => {
  if (!packageName || !productId || !purchaseToken) {
    throw new Error('packageName, productId, and purchaseToken are required.');
  }

  const auth = createGooglePlayAuth();
  const androidpublisher = google.androidpublisher('v3');

  try {
    await androidpublisher.purchases.products.consume({
      packageName,
      productId,
      token: purchaseToken,
      auth,
    });
  } catch (err) {
    console.warn('Google Play product purchase consumption failed:', {
      message: err.message,
      status: err.response?.status,
      code: err.code,
      productId,
      packageName,
    });
    throw new Error('Google Play purchase consumption failed.');
  }
};

module.exports = {
  consumeGooglePlayProductPurchase,
  verifyGooglePlayProductPurchase,
};
