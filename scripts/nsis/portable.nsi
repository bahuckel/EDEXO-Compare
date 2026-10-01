; ED Exo Compare's portable launcher: electron-builder 26.8.1's templates/nsis/portable.nsi with one
; change (combined plan 1.6a, 2026-10-01). scripts/dist-win.mjs copies it over the template before
; every build, because electron-builder reads the portable script from its own folder and has no
; option for another.
;
; The stock script deletes the unpack folder before it unpacks, and again after the app exits. With
; unpackDirName fixed ("EDExoPortable", so the Windows firewall rule keeps one path), that folder is
; the running copy's: starting the exe a second time, which now brings the running launcher back,
; deleted every file the running app had not locked (its web pages, its data), and the app answered
; 404 until it was restarted. Here, when the app in that folder is running (its exe cannot be opened
; for writing), the launcher just starts it again with the same arguments and leaves the folder alone:
; the running copy's single-instance lock brings its launcher forward and the new copy exits. The
; folder is deleted after the app exits only when nothing is running from it any more.

!include "common.nsh"
!include "extractAppPackage.nsh"

# https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Var EdexoRunning
Var EdexoMutex

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif

  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir

  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

; Sets $EdexoRunning to 1 when the app's exe in $INSTDIR is in use (a running exe cannot be opened
; for writing), else 0.
Function EdexoCheckRunning
  StrCpy $EdexoRunning 0
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ClearErrors
    FileOpen $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
    ${If} ${Errors}
      StrCpy $EdexoRunning 1
    ${Else}
      FileClose $1
    ${EndIf}
  ${EndIf}
FunctionEnd

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  ; Every copy of this launcher holds this name while it runs, so one that is done can tell whether
  ; another (a "Restart now" relaunch) is unpacking into the same folder before it deletes it.
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "EDExoPortableLauncher") p .s'
  Pop $EdexoMutex

  StrCpy $INSTDIR "$PLUGINSDIR\app"
  !ifdef UNPACK_DIR_NAME
    StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"
  !endif

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  Call EdexoCheckRunning
  ${If} $EdexoRunning == 1
    ; Already running from here: hand over, keep its files.
    !ifdef SPLASH_IMAGE
      BgImage::Destroy
    !endif
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0'
    SetOutPath $EXEDIR
    Return
  ${EndIf}

  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        {endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  !ifdef SPLASH_IMAGE
    BgImage::Destroy
  !endif

	ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0

  SetOutPath $EXEDIR
  ; Only when nothing runs from the folder and no other copy of this launcher is about: a relaunch
  ; starts one as the app exits, and it may be unpacking here.
  System::Call 'kernel32::CloseHandle(p $EdexoMutex)'
  Sleep 2000
  System::Call 'kernel32::OpenMutex(i 0x00100000, i 0, t "EDExoPortableLauncher") p .s'
  Pop $1
  Call EdexoCheckRunning
  ${If} $1 == 0
  ${AndIf} $EdexoRunning == 0
	  RMDir /r $INSTDIR
  ${ElseIf} $1 != 0
    System::Call 'kernel32::CloseHandle(p r1)'
  ${EndIf}
SectionEnd
