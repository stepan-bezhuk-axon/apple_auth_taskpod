const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const firestoreDB = admin.firestore();

const express = require("express");
const AppleAuth = require("apple-auth");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");

const app = express();

app.use(bodyParser.urlencoded({extended: false}));
app.use(express.static("public"));

exports.callbackApple = functions.https.onRequest((request, response) => {
  const redirect = `intent://callback?${new URLSearchParams(
      request.body,
  ).toString()}#Intent;package=${
    functions.config().android_package_name.id
  };scheme=signinwithapple;end`;
  console.log(redirect);
  response.redirect(307, redirect);
});

exports.signInApple = functions.https.onRequest(async (request, response) => {
  const useBundleId = request.query.useBundleId === "true";
  const bundleId = functions.config().bundle_id.id;
  const serviceId = functions.config().service_id.id;

  const auth = new AppleAuth({
    client_id: useBundleId ? bundleId : serviceId,
    team_id: functions.config().team_id.id,
    redirect_uri: "https://us-central1-taskpod-cfcbd.cloudfunctions.net/callbackApple",
    key_id: functions.config().key_id.id,
  },
  functions.config().secret.id.replace(/\|/g, "\n"),
  "text",
  );

  const accessToken = await auth.accessToken(request.query.code);

  const idToken = jwt.decode(accessToken.id_token);

  const userID = idToken.sub;

  const userEmail = idToken.email;
  const userName = `${request.query.firstName} ${request.query.lastName}`;

  const sessionID = `NEW SESSION ID ${userID} / ${userEmail} / ${userName}`;

  response.json({sessionId: sessionID});
});

exports.firstOpen=functions.analytics.event("open_app").onLog((event) => {
  const _docId = event.params["document_id"];
  console.log(`DOC_SET: ${_docId}`);
  const data = {
    deviceId: _docId,
    firstOpen: event.logTime,
    fcmId: `${event.params["left_fcm_id"]}${event.params["right_fcm_id"]}`,
    isUserInSystem: false,
  };

  return firestoreDB.collection("users").doc(_docId).set(data);
});

exports.openSession=functions.analytics.event("open_session")
    .onLog((event) => {
      const _docId = event.params["document_id"];
      console.log(`DOC_UPDATE: ${_docId}`);
      const data = {
        isUserInSystem: true,
      };

      return firestoreDB.collection("users").doc(_docId).update(data);
    });

exports.cron = functions.pubsub.schedule("0 12 */2 * *").onRun((context) => {
  firestoreDB.collection("users").get().then((querySnapshot) => {
    querySnapshot.forEach((doc) => {
      const _fcmId = doc.data().fcmId;
      const _isUserInSystem = doc.data().isUserInSystem;
      console.log(doc.data().fcmId);
      const payload = {
        notification: {
          title: "Taskpod",
          body: `Are you ready to try TaskPod? 
Sign up now to change the way you work and live.`,
        },
        data: {
          "subject": "USER_NOT_REGISTRATION",
        },
      };
      if (!_isUserInSystem) {
        return admin.messaging().sendToDevice(_fcmId, payload);
      } else {
        return null;
      }
    });
  });
  return null;
});
