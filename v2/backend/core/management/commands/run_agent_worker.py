import os
from pathlib import Path
from time import sleep
import msvcrt

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from core.runtime import claim_next_run, execute_chat_run


class Command(BaseCommand):
    help = "Executa a fila local persistente de chats e flows."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Processa no máximo uma execução e encerra.")

    def handle(self, *args, **options):
        lock_path = Path(__file__).resolve().parents[4] / ".logs" / "agent-worker.pid"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        lock_handle = lock_path.open("a+", encoding="utf-8")
        lock_handle.seek(0, os.SEEK_END)
        if lock_handle.tell() == 0:
            lock_handle.write("0")
            lock_handle.flush()
        lock_handle.seek(0)
        try:
            msvcrt.locking(lock_handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            lock_handle.close()
            self.stdout.write("Um worker local já está ativo.")
            return
        lock_handle.seek(0)
        lock_handle.truncate()
        lock_handle.write(str(os.getpid()))
        lock_handle.flush()
        self.stdout.write(self.style.SUCCESS("Worker local de agentes iniciado."))
        try:
            while True:
                close_old_connections()
                run_id = claim_next_run()
                if run_id:
                    execute_chat_run(run_id)
                elif options["once"]:
                    return
                else:
                    sleep(0.35)
                if options["once"]:
                    return
        finally:
            lock_handle.seek(0)
            msvcrt.locking(lock_handle.fileno(), msvcrt.LK_UNLCK, 1)
            lock_handle.close()
            lock_path.unlink(missing_ok=True)
