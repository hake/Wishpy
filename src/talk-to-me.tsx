
import { Action, ActionPanel, Detail, Form, Icon, Toast, showToast, getPreferenceValues } from "@raycast/api";
import { useState, useCallback, useEffect } from "react";
import { execa } from "execa";
import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";

interface Preferences {
  apiKey?: string;
}

export default function Command() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const preferences = getPreferenceValues<Preferences>();
  
  const startRecording = useCallback(async () => {
    try {
      setIsLoading(true);
      setIsRecording(true);
      setError(null);
      
      // Create temporary file path for audio
      const tempDir = os.tmpdir();
      const audioFilePath = path.join(tempDir, "recording.wav");
      
      // Show toast notification
      await showToast(Toast.Style.Animated, "Recording...", "Speak now");
      
      // Record audio using system command
      const recordingProcess = execa("rec", [
        "-r", "16000",
        "-c", "1",
        "-b", "16",
        audioFilePath,
        "trim", "0", "10", // Record for 10 seconds max
      ]);
      
      // Wait for the recording to finish
      setTimeout(async () => {
        try {
          recordingProcess.kill();
          
          await showToast(Toast.Style.Animated, "Processing...", "Converting speech to text");
          
          // Check if API key is available
          if (!preferences.apiKey) {
            throw new Error("OpenAI API key not set. Please set it in the extension preferences.");
          }
          
          // Initialize OpenAI client
          const openai = new OpenAI({
            apiKey: preferences.apiKey,
          });
          
          // Send audio file to OpenAI Whisper API
          const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioFilePath),
            model: "whisper-1",
          });
          
          // Get transcription
          const text = response.text;
          setTranscription(text);
          
          // Copy text to clipboard and paste to active input
          await execa("pbpaste", [text]);
          await execa("osascript", [
            "-e", 
            `tell application "System Events" to keystroke "v" using command down`
          ]);
          
          await showToast(Toast.Style.Success, "Success", "Text inserted into active input");
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          setError(errorMessage);
          await showToast(Toast.Style.Failure, "Error", errorMessage);
        } finally {
          setIsRecording(false);
          setIsLoading(false);
          
          // Clean up temporary file
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
          }
        }
      }, 10000); // 10 seconds recording limit
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setIsRecording(false);
      setIsLoading(false);
      await showToast(Toast.Style.Failure, "Error", errorMessage);
    }
  }, [preferences.apiKey]);
  
  return (
    <Detail
      isLoading={isLoading}
      markdown={getMarkdown(transcription, error)}
      actions={
        <ActionPanel>
          <Action
            title={isRecording ? "Recording..." : "Start Recording"}
            icon={isRecording ? Icon.Record : Icon.Microphone}
            onAction={startRecording}
            disabled={isRecording}
          />
        </ActionPanel>
      }
    />
  );
}

function getMarkdown(transcription: string, error: string | null): string {
  let markdown = "# Talk to Me\n\n";
  
  if (error) {
    markdown += `## Error\n\n${error}\n\n`;
  }
  
  if (transcription) {
    markdown += `## Transcription\n\n${transcription}\n\n`;
  } else if (!error) {
    markdown += "Click the 'Start Recording' button and speak into your microphone.\n\n";
    markdown += "Your speech will be converted to text and pasted into the active input field.\n\n";
    markdown += "Note: Make sure you have set your OpenAI API key in the extension preferences.";
  }
  
  return markdown;
}
