import Editor from "@/components/editor";    
import FirebaseLoginGate from "@/components/firebase-login-gate";   
export default function Page() {
    return (
        <FirebaseLoginGate>
            <main className="flex-1 flex flex-col">
                <Editor />
            </main>
        </FirebaseLoginGate>
    )}