import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: keystore + passwords live OUTSIDE the repository.
// Default location ~/.masjid-pulse-keys/keystore.properties (override with -PmpKeystoreProps=/path).
// Keys: storeFile, storePassword, keyAlias, keyPassword. Without it, assembleRelease is unsigned.
val keystorePropsFile = file(
    (findProperty("mpKeystoreProps") as String?)
        ?: "${System.getProperty("user.home")}/.masjid-pulse-keys/keystore.properties",
)
val keystoreProps = Properties().apply { if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) } }

// Default server URL baked into the build (can be changed on the TV). Empty = ask on first launch.
val defaultServerUrl = (findProperty("mpServerUrl") as String?) ?: ""

android {
    namespace = "com.masjidpulse.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.masjidpulse.tv"
        minSdk = 21 // Android 5.0 - covers older Fire TV sticks
        targetSdk = 34
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServerUrl\"")
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
    lint {
        abortOnError = true
        warningsAsErrors = false
        disable += setOf("GradleDependency", "OldTargetApi", "NewerVersionAvailable")
    }
}

// Bundle the TV web app (../public/tv, brand, icons) into the APK so it works offline on first launch.
val copyWebAssets by tasks.registering(Copy::class) {
    val publicDir = rootProject.file("../public")
    doFirst {
        if (!File(publicDir, "tv/app.js").exists()) {
            throw GradleException("public/tv/app.js missing - run `npm run build:web` in the repo root first")
        }
    }
    from(publicDir) {
        include("tv/**", "brand/**", "icons/**")
        exclude("tv/sw.js")
    }
    into(layout.buildDirectory.dir("generated/webassets"))
}
tasks.named("preBuild") { dependsOn(copyWebAssets) }

dependencies {
    implementation("androidx.webkit:webkit:1.8.0")
    testImplementation("junit:junit:4.13.2")
}
