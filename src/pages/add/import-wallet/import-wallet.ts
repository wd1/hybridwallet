import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { Events, NavController, NavParams } from 'ionic-angular';
import { Logger } from '../../../providers/logger/logger';

// Pages
import { ScanPage } from '../../scan/scan';

// Providers
import { ActionSheetProvider } from '../../../providers/action-sheet/action-sheet';
import { BwcProvider } from '../../../providers/bwc/bwc';
import { ConfigProvider } from '../../../providers/config/config';
import { DerivationPathHelperProvider } from '../../../providers/derivation-path-helper/derivation-path-helper';
import { OnGoingProcessProvider } from '../../../providers/on-going-process/on-going-process';
import { PersistenceProvider } from '../../../providers/persistence/persistence';
import { PlatformProvider } from '../../../providers/platform/platform';
import { PopupProvider } from '../../../providers/popup/popup';
import { ProfileProvider } from '../../../providers/profile/profile';
import { PushNotificationsProvider } from '../../../providers/push-notifications/push-notifications';
import {
  WalletOptions,
  WalletProvider
} from '../../../providers/wallet/wallet';

@Component({
  selector: 'page-import-wallet',
  templateUrl: 'import-wallet.html'
})
export class ImportWalletPage {
  private derivationPathByDefault: string;
  private derivationPathForTestnet: string;
  private reader: FileReader;
  private defaults;
  private errors;

  public importForm: FormGroup;
  public prettyFileName: string;
  public importErr: boolean;
  public formFile;
  public showAdvOpts: boolean;
  public selectedTab: string;
  public isCordova: boolean;
  public isSafari: boolean;
  public isIOS: boolean;
  public file: File;
  public code;
  public okText: string;
  public cancelText: string;
  public coin: string;
  public createLabel: string;

  constructor(
    private navCtrl: NavController,
    private navParams: NavParams,
    private form: FormBuilder,
    private bwcProvider: BwcProvider,
    private derivationPathHelperProvider: DerivationPathHelperProvider,
    private walletProvider: WalletProvider,
    private configProvider: ConfigProvider,
    private popupProvider: PopupProvider,
    private platformProvider: PlatformProvider,
    private logger: Logger,
    private onGoingProcessProvider: OnGoingProcessProvider,
    private profileProvider: ProfileProvider,
    private translate: TranslateService,
    private events: Events,
    private pushNotificationsProvider: PushNotificationsProvider,
    private actionSheetProvider: ActionSheetProvider,
    private persistenceProvider: PersistenceProvider
  ) {
    this.okText = this.translate.instant('Ok');
    this.cancelText = this.translate.instant('Cancel');
    this.reader = new FileReader();
    this.defaults = this.configProvider.getDefaults();
    this.errors = bwcProvider.getErrors();
    this.coin = this.navParams.get('coin');

    this.isCordova = this.platformProvider.isCordova;
    this.isSafari = this.platformProvider.isSafari;
    this.isIOS = this.platformProvider.isIOS;
    this.importErr = false;
    this.code = this.navParams.data.code;
    this.selectedTab = 'words';
    this.derivationPathByDefault =
      this.coin == 'bch'
        ? this.derivationPathHelperProvider.defaultBCH
        : this.derivationPathHelperProvider.defaultBTC;
    this.derivationPathForTestnet = this.derivationPathHelperProvider.defaultTestnet;
    this.showAdvOpts = false;
    this.formFile = null;

    this.importForm = this.form.group({
      words: [null, Validators.required],
      backupText: [null],
      passphrase: [null],
      file: [null],
      filePassword: [null],
      derivationPath: [this.derivationPathByDefault, Validators.required],
      testnetEnabled: [false],
      bwsURL: [this.defaults.bws.url],
      coin: [null, Validators.required],
      importVault: [false]
    });
    this.importForm.controls['coin'].setValue(this.coin);
    this.events.subscribe('Local/BackupScan', this.updateWordsHandler);
    this.createLabel =
      this.coin === 'btc'
        ? this.translate.instant('BTC Wallet')
        : this.translate.instant('BCH Wallet');

    this.persistenceProvider.getVault().then(vault => {
      if (vault) this.importForm.controls['importVault'].disable();
    });
  }

  ionViewWillEnter() {
    if (this.code) {
      this.processWalletInfo(this.code);
    }
  }

  ngOnDestroy() {
    this.events.unsubscribe('Local/BackupScan', this.updateWordsHandler);
  }

  private updateWordsHandler: any = data => {
    this.processWalletInfo(data.value);
  };

  public selectTab(tab: string): void {
    this.selectedTab = tab;

    switch (tab) {
      case 'words':
        this.file = null;
        this.formFile = null;
        this.importForm.get('words').setValidators([Validators.required]);
        this.importForm.get('coin').setValidators([Validators.required]);
        this.importForm.get('filePassword').clearValidators();
        if (this.isCordova || this.isSafari)
          this.importForm.get('backupText').clearValidators();
        else this.importForm.get('file').clearValidators();
        break;
      case 'file':
        if (this.isCordova || this.isSafari)
          this.importForm
            .get('backupText')
            .setValidators([Validators.required]);
        else this.importForm.get('file').setValidators([Validators.required]);
        this.importForm
          .get('filePassword')
          .setValidators([Validators.required]);
        this.importForm.get('words').clearValidators();
        this.importForm.get('coin').clearValidators();
        break;

      default:
        this.importForm.get('words').clearValidators();
        this.importForm.get('file').clearValidators();
        this.importForm.get('filePassword').clearValidators();
        break;
    }
    this.importForm.get('words').updateValueAndValidity();
    this.importForm.get('file').updateValueAndValidity();
    this.importForm.get('filePassword').updateValueAndValidity();
    this.importForm.get('backupText').updateValueAndValidity();
    this.importForm.get('coin').updateValueAndValidity();
  }

  public onChangeImportVault(importVault: boolean): void {
    if (importVault) {
      this.importForm.get('coin').clearValidators();
    } else {
      this.importForm.get('coin').setValidators([Validators.required]);
    }
    this.importForm.get('coin').updateValueAndValidity();
  }

  private processWalletInfo(code: string): void {
    if (!code) return;

    this.importErr = false;
    const parsedCode = code.split('|');

    const info = {
      type: parsedCode[0],
      data: parsedCode[1],
      network: parsedCode[2],
      derivationPath: parsedCode[3],
      hasPassphrase: parsedCode[4] == 'true' ? true : false,
      coin: parsedCode[5]
    };
    if (!info.data) {
      const errorInfoSheet = this.actionSheetProvider.createInfoSheet(
        'default-error',
        {
          msg: this.translate.instant('Invalid data'),
          title: this.translate.instant('Error')
        }
      );
      errorInfoSheet.present();
    }
    if (info.type == '1' && info.hasPassphrase) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant(
        'Password required. Make sure to enter your password in advanced options'
      );
      this.popupProvider.ionicAlert(title, subtitle);
    }

    const isTestnet = info.network == 'testnet' ? true : false;
    this.importForm.controls['testnetEnabled'].setValue(isTestnet);
    this.importForm.controls['derivationPath'].setValue(info.derivationPath);
    this.importForm.controls['words'].setValue(info.data);
    this.importForm.controls['coin'].setValue(info.coin);
  }

  public setDerivationPath(): void {
    const path = this.importForm.value.testnetEnabled
      ? this.derivationPathForTestnet
      : this.derivationPathByDefault;
    this.importForm.controls['derivationPath'].setValue(path);
  }

  private importBlob(str: string, opts): void {
    let str2: string;
    let err = null;
    try {
      str2 = this.bwcProvider
        .getSJCL()
        .decrypt(this.importForm.value.filePassword, str);
    } catch (e) {
      err = this.translate.instant(
        'Could not decrypt file, check your password'
      );
      this.logger.error('Import: could not decrypt file', e);
    }

    if (err) {
      const title = this.translate.instant('Error');
      this.popupProvider.ionicAlert(title, err);
      return;
    }

    this.onGoingProcessProvider.set('importingWallet');
    opts.compressed = null;
    opts.password = null;

    setTimeout(() => {
      this.profileProvider
        .importWallet(str2, opts)
        .then(wallet => {
          this.onGoingProcessProvider.clear();
          this.finish([].concat(wallet));
        })
        .catch(err => {
          this.onGoingProcessProvider.clear();
          const title = this.translate.instant('Error');
          this.popupProvider.ionicAlert(title, err);
          return;
        });
    }, 100);
  }

  private async finish(wallets) {
    wallets.forEach(wallet => {
      this.walletProvider.updateRemotePreferences(wallet);
      this.profileProvider.setBackupFlag(wallet.credentials.walletId);
      this.pushNotificationsProvider.updateSubscription(wallet);
    });
    this.navCtrl.popToRoot();
  }

  private importExtendedPrivateKey(xPrivKey, opts) {
    this.onGoingProcessProvider.set('importingWallet');
    setTimeout(() => {
      this.profileProvider
        .importExtendedPrivateKey(xPrivKey, opts)
        .then(wallet => {
          this.onGoingProcessProvider.clear();
          this.finish([].concat(wallet));
        })
        .catch(err => {
          if (err instanceof this.errors.NOT_AUTHORIZED) {
            this.importErr = true;
          } else {
            const title = this.translate.instant('Error');
            this.popupProvider.ionicAlert(title, err);
          }
          this.onGoingProcessProvider.clear();
          return;
        });
    }, 100);
  }

  private importMnemonic(words: string, opts): void {
    this.onGoingProcessProvider.set('importingWallet');
    setTimeout(() => {
      this.profileProvider
        .importSingleSeedMnemonic(words, opts)
        .then(wallet => {
          this.onGoingProcessProvider.clear();
          this.finish([].concat(wallet));
        })
        .catch(err => {
          if (err instanceof this.errors.NOT_AUTHORIZED) {
            this.importErr = true;
          } else {
            const title = this.translate.instant('Error');
            this.popupProvider.ionicAlert(title, err);
          }
          this.onGoingProcessProvider.clear();
          return;
        });
    }, 100);
  }

  private importVaultWallets(words: string, opts): void {
    this.onGoingProcessProvider.set('importingVault');
    this.profileProvider
      .importVaultWallets(words, opts)
      .then(wallets => {
        this.onGoingProcessProvider.clear();
        this.finish(wallets);
      })
      .catch(err => {
        this.onGoingProcessProvider.clear();
        const title = this.translate.instant('Error');
        this.popupProvider.ionicAlert(title, err);
      });
  }

  public import(): void {
    if (this.selectedTab === 'file') {
      this.importFromFile();
    } else {
      this.importFromMnemonic();
    }
  }

  public importFromFile(): void {
    if (!this.importForm.valid) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant('There is an error in the form');
      this.popupProvider.ionicAlert(title, subtitle);
      return;
    }

    const backupFile = this.file;
    const backupText = this.importForm.value.backupText;

    if (!backupFile && !backupText) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant(
        'Please, select your backup file'
      );
      this.popupProvider.ionicAlert(title, subtitle);
      return;
    }

    if (backupFile) {
      this.reader.readAsBinaryString(backupFile);
    } else {
      const opts: Partial<WalletOptions> = {};
      opts.bwsurl = this.importForm.value.bwsURL;
      opts.coin = this.importForm.value.coin;
      this.importBlob(backupText, opts);
    }
  }

  public importFromMnemonic(): void {
    if (!this.importForm.valid) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant('There is an error in the form');
      this.popupProvider.ionicAlert(title, subtitle);
      return;
    }

    const opts: Partial<WalletOptions> = {};

    if (this.importForm.value.bwsURL)
      opts.bwsurl = this.importForm.value.bwsURL;

    const derivationPath = this.importForm.value.derivationPath;

    opts.networkName = this.derivationPathHelperProvider.getNetworkName(
      derivationPath
    );
    opts.derivationStrategy = this.derivationPathHelperProvider.getDerivationStrategy(
      derivationPath
    );
    opts.account = this.derivationPathHelperProvider.getAccount(derivationPath);

    opts.coin = this.importForm.value.coin;

    opts.passphrase = this.importForm.value.passphrase || null;

    if (
      !opts.networkName ||
      !opts.derivationStrategy ||
      !Number.isInteger(opts.account)
    ) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant('Invalid derivation path');
      this.popupProvider.ionicAlert(title, subtitle);
      return;
    }

    if (
      !this.derivationPathHelperProvider.isValidDerivationPathCoin(
        this.importForm.value.derivationPath,
        this.coin
      )
    ) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant(
        'Invalid derivation path for selected coin'
      );
      this.popupProvider.ionicAlert(title, subtitle);
      return;
    }

    const words: string = this.importForm.value.words || null;

    if (!words) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant(
        'Please enter the recovery phrase'
      );
      this.popupProvider.ionicAlert(title, subtitle);
      return;
    } else if (words.indexOf('xprv') == 0 || words.indexOf('tprv') == 0) {
      return this.importExtendedPrivateKey(words, opts);
    } else {
      const wordList = words.trim().split(/[\u3000\s]+/);

      if (wordList.length % 3 != 0) {
        const title = this.translate.instant('Error');
        const subtitle = this.translate.instant(
          'Wrong number of recovery words:'
        );
        this.popupProvider.ionicAlert(title, subtitle + ' ' + wordList.length);
        return;
      }
    }

    if (this.importForm.value.importVault) {
      this.importVaultWallets(words, opts);
    } else {
      this.importMnemonic(words, opts);
    }
  }

  public fileChangeEvent($event) {
    this.file = $event.target
      ? $event.target.files[0]
      : $event.srcElement.files[0];
    this.formFile = $event.target.value;
    // Most browsers return `C:\fakepath\FILENAME`
    this.prettyFileName = this.formFile.split('\\').pop();
    this.getFile();
  }

  private getFile() {
    // If we use onloadend, we need to check the readyState.
    this.reader.onloadend = () => {
      if (this.reader.readyState === 2) {
        // DONE === 2
        const opts: Partial<WalletOptions> = {};
        opts.bwsurl = this.importForm.value.bwsURL;
        opts.coin = this.importForm.value.coin;
        const reader: string = this.reader.result.toString();
        this.importBlob(reader, opts);
      }
    };
  }

  public openScanner(): void {
    this.navCtrl.push(ScanPage, { fromImport: true });
  }
}
