import Link from "next/link";
import styles from "./flows.module.css";

export default function FlowsPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p>INDEV · SISTEMAS MULTIAGENTE</p>
          <h1>Fluxos locais</h1>
          <span>O canvas usa apenas o runtime local e os modelos carregados no LM Studio/Bionic.</span>
        </div>
        <Link href="/">← Voltar ao chat</Link>
      </header>
      <section className={styles.canvas}>
        <iframe
          title="Langflow integrado ao InDev"
          src="http://127.0.0.1:7860"
          allow="clipboard-read; clipboard-write"
        />
      </section>
    </main>
  );
}
