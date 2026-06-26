import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "firebase/auth";

document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // Bei Erfolg weiter zur App
        window.location.href = "index.html";
    } catch (error) {
        errorMsg.innerText = "Fehler: " + error.message;
    }
});
