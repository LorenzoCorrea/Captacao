#!/bin/sh
# Monta o APK do Jarvis sem Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner. Saída: jarvis.apk
set -e
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}; BT=$SDK/build-tools/35.0.0; JAR=$SDK/platforms/android-35/android.jar
rm -rf build && mkdir -p build/classes build/dex
[ -f res/drawable/icon.png ] || rsvg-convert -w 192 -h 192 icon.svg -o res/drawable/icon.png
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml -A assets -o build/app.apk build/res.zip --java build/gen \
  --min-sdk-version 29 --target-sdk-version 34 --version-code 1 --version-name 0.1
# javac: usa o do sistema ou, sem JDK instalado, um container com JDK
J=$(ls -d $HOME/.local/jdk/*/bin 2>/dev/null | head -1); [ -n "$J" ] && PATH="$J:$PATH"   # JDK portátil (sem sudo)
if command -v javac >/dev/null; then JAVAC="javac"; else
  JAVAC="docker run --rm -u $(id -u):$(id -g) -v $(pwd):/w -v $JAR:/android.jar:ro -w /w eclipse-temurin:17-jdk javac"; JAR_IN=/android.jar; fi
$JAVAC -nowarn --release 17 -classpath "${JAR_IN:-$JAR}" -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --min-api 29 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../app.apk classes.dex)
"$BT/zipalign" -f 4 build/app.apk build/aligned.apk
# chave própria de teste (fica fora do servidor; perder = reinstalar o app)
[ -f jarvis.keystore ] || keytool -genkeypair -keystore jarvis.keystore -alias jarvis -keyalg RSA -keysize 2048 \
  -validity 10000 -storepass jarvisapp -keypass jarvisapp -dname "CN=Jarvis" >/dev/null 2>&1
"$BT/apksigner" sign --ks jarvis.keystore --ks-pass pass:jarvisapp --out jarvis.apk build/aligned.apk
echo "ok: $(pwd)/jarvis.apk"
