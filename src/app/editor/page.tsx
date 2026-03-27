import Editor from "@/components/editor";    
import FirebaseLoginGate from "@/components/Navbar";   
export default function Page() {
    return (
        <FirebaseLoginGate>
            <main className="flex-1 flex flex-col">
                <Editor />
            </main>
        </FirebaseLoginGate>
    )}