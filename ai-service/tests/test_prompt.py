import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.prompt import BASE_SYSTEM_PROMPT, current_system_prompt


class PromptTest(unittest.TestCase):
    def test_reads_changes_and_uses_default_if_file_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prompt.txt"
            with patch.dict(os.environ, {"AI_SYSTEM_PROMPT_FILE": str(path)}):
                self.assertEqual(current_system_prompt(), BASE_SYSTEM_PROMPT)
                path.write_text("Новая инструкция", encoding="utf-8")
                self.assertEqual(current_system_prompt(), "Новая инструкция")

    def test_unreadable_directory_is_not_silently_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"AI_SYSTEM_PROMPT_FILE": directory}):
                with self.assertRaises(IsADirectoryError):
                    current_system_prompt()
