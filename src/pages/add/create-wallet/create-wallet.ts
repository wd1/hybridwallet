import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { Events, NavController, NavParams } from 'ionic-angular';
import { Logger } from '../../../providers/logger/logger';

// Providers
import { BwcErrorProvider } from '../../../providers/bwc-error/bwc-error';
import { ConfigProvider } from '../../../providers/config/config';
import { DerivationPathHelperProvider } from '../../../providers/derivation-path-helper/derivation-path-helper';
import { ExternalLinkProvider } from '../../../providers/external-link/external-link';
import { OnGoingProcessProvider } from '../../../providers/on-going-process/on-going-process';
import { PopupProvider } from '../../../providers/popup/popup';
import { ProfileProvider } from '../../../providers/profile/profile';
import { PushNotificationsProvider } from '../../../providers/push-notifications/push-notifications';
import {
  WalletOptions,
  WalletProvider
} from '../../../providers/wallet/wallet';

import * as _ from 'lodash';

@Component({
  selector: 'page-create-wallet',
  templateUrl: 'create-wallet.html'
})
export class CreateWalletPage implements OnInit {
  /* For compressed keys, m*73 + n*34 <= 496 */
  private COPAYER_PAIR_LIMITS = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 4,
    6: 4,
    7: 3,
    8: 3,
    9: 2,
    10: 2,
    11: 1,
    12: 1
  };

  private defaults;
  private tc: number;
  private derivationPathByDefault: string;
  private derivationPathForTestnet: string;

  public copayers: number[];
  public signatures: number[];
  public showAdvOpts: boolean;
  public seedOptions;
  public isShared: boolean;
  public coin: string;
  public okText: string;
  public cancelText: string;
  public createForm: FormGroup;
  public createLabel: string;

  constructor(
    private navCtrl: NavController,
    private navParams: NavParams,
    private fb: FormBuilder,
    private profileProvider: ProfileProvider,
    private configProvider: ConfigProvider,
    private derivationPathHelperProvider: DerivationPathHelperProvider,
    private popupProvider: PopupProvider,
    private onGoingProcessProvider: OnGoingProcessProvider,
    private logger: Logger,
    private walletProvider: WalletProvider,
    private translate: TranslateService,
    private events: Events,
    private pushNotificationsProvider: PushNotificationsProvider,
    private externalLinkProvider: ExternalLinkProvider,
    private bwcErrorProvider: BwcErrorProvider
  ) {
    this.okText = this.translate.instant('Ok');
    this.cancelText = this.translate.instant('Cancel');
    this.isShared = this.navParams.get('isShared');
    this.coin = this.navParams.get('coin');
    this.defaults = this.configProvider.getDefaults();
    this.tc = this.isShared ? this.defaults.wallet.totalCopayers : 1;
    this.copayers = _.range(2, this.defaults.limits.totalCopayers + 1);
    this.derivationPathByDefault =
      this.coin == 'bch'
        ? this.derivationPathHelperProvider.defaultBCH
        : this.derivationPathHelperProvider.defaultBTC;
    this.derivationPathForTestnet = this.derivationPathHelperProvider.defaultTestnet;
    this.showAdvOpts = false;

    this.createForm = this.fb.group({
      walletName: [null, Validators.required],
      myName: [null],
      totalCopayers: [1],
      requiredCopayers: [1],
      bwsURL: [this.defaults.bws.url],
      selectedSeed: ['new'],
      recoveryPhrase: [null],
      derivationPath: [this.derivationPathByDefault],
      testnetEnabled: [false],
      singleAddress: [false],
      coin: [null, Validators.required]
    });
    this.createForm.controls['coin'].setValue(this.coin);
    this.createLabel =
      this.coin === 'btc'
        ? this.translate.instant('BTC Wallet')
        : this.translate.instant('BCH Wallet');

    this.setTotalCopayers(this.tc);
    this.updateRCSelect(this.tc);
  }

  ngOnInit() {
    if (this.isShared) {
      this.createForm.get('myName').setValidators([Validators.required]);
    }
  }

  public setTotalCopayers(n: number): void {
    this.createForm.controls['totalCopayers'].setValue(n);
    this.updateRCSelect(n);
    this.updateSeedSourceSelect();
  }

  private updateRCSelect(n: number): void {
    this.createForm.controls['totalCopayers'].setValue(n);
    const maxReq = this.COPAYER_PAIR_LIMITS[n];
    this.signatures = _.range(1, maxReq + 1);
    this.createForm.controls['requiredCopayers'].setValue(
      Math.min(Math.trunc(n / 2 + 1), maxReq)
    );
  }

  private updateSeedSourceSelect(): void {
    this.seedOptions = [
      {
        id: 'new',
        label: this.translate.instant('Random'),
        supportsTestnet: true
      },
      {
        id: 'set',
        label: this.translate.instant('Specify Recovery Phrase'),
        supportsTestnet: false
      }
    ];
    this.createForm.controls['selectedSeed'].setValue(this.seedOptions[0].id); // new or set
  }

  public seedOptionsChange(seed): void {
    if (seed === 'set') {
      this.createForm
        .get('recoveryPhrase')
        .setValidators([Validators.required]);
    } else {
      this.createForm.get('recoveryPhrase').setValidators(null);
    }
    this.createForm.controls['selectedSeed'].setValue(seed); // new or set
    if (this.createForm.controls['testnet'])
      this.createForm.controls['testnet'].setValue(false);
    this.createForm.controls['derivationPath'].setValue(
      this.derivationPathByDefault
    );
    this.createForm.controls['recoveryPhrase'].setValue(null);
  }

  public setDerivationPath(): void {
    const path: string = this.createForm.value.testnet
      ? this.derivationPathForTestnet
      : this.derivationPathByDefault;
    this.createForm.controls['derivationPath'].setValue(path);
  }

  public setOptsAndCreate(): void {
    const opts: Partial<WalletOptions> = {
      name: this.createForm.value.walletName,
      m: this.createForm.value.requiredCopayers,
      n: this.createForm.value.totalCopayers,
      myName:
        this.createForm.value.totalCopayers > 1
          ? this.createForm.value.myName
          : null,
      networkName: this.createForm.value.testnetEnabled ? 'testnet' : 'livenet',
      bwsurl: this.createForm.value.bwsURL,
      singleAddress: this.createForm.value.singleAddress,
      coin: this.createForm.value.coin
    };

    const setSeed = this.createForm.value.selectedSeed == 'set';
    if (setSeed) {
      const words = this.createForm.value.recoveryPhrase || '';
      if (
        words.indexOf(' ') == -1 &&
        words.indexOf('prv') == 1 &&
        words.length > 108
      ) {
        opts.extendedPrivateKey = words;
      } else {
        opts.mnemonic = words;
      }

      const derivationPath = this.createForm.value.derivationPath;
      opts.networkName = this.derivationPathHelperProvider.getNetworkName(
        derivationPath
      );
      opts.derivationStrategy = this.derivationPathHelperProvider.getDerivationStrategy(
        derivationPath
      );
      opts.account = this.derivationPathHelperProvider.getAccount(
        derivationPath
      );

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
    }

    if (setSeed && !opts.mnemonic && !opts.extendedPrivateKey) {
      const title = this.translate.instant('Error');
      const subtitle = this.translate.instant(
        'Please enter the wallet recovery phrase'
      );
      this.popupProvider.ionicAlert(title, subtitle);
      return;
    }

    if (
      !this.derivationPathHelperProvider.isValidDerivationPathCoin(
        this.createForm.value.derivationPath,
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

    if (
      this.coin == 'bch' &&
      this.derivationPathHelperProvider.parsePath(
        this.createForm.value.derivationPath
      ).coinCode == "0'"
    ) {
      opts.use0forBCH = true;
      this.logger.debug('Using 0 for BCH creation');
    }

    this.create(opts);
  }

  private create(opts): void {
    this.onGoingProcessProvider.set('creatingWallet');
    const promise = this.createForm.value.addToVault
      ? this.profileProvider.createWalletInVault(opts)
      : this.profileProvider.createNewSeedWallet(opts);
    promise
      .then(wallet => {
        this.onGoingProcessProvider.clear();
        this.walletProvider.updateRemotePreferences(wallet);
        this.pushNotificationsProvider.updateSubscription(wallet);
        this.setBackupFlagIfNeeded(wallet.credentials.walletId);
        this.setFingerprintIfNeeded(wallet.credentials.walletId);
        this.navCtrl.popToRoot().then(() => {
          setTimeout(() => {
            this.events.publish('OpenWallet', wallet);
          }, 1000);
        });
      })
      .catch(err => {
        this.onGoingProcessProvider.clear();
        if (
          err &&
          err.message != 'FINGERPRINT_CANCELLED' &&
          err.message != 'PASSWORD_CANCELLED'
        ) {
          this.logger.error('Create: could not create wallet', err);
          const title = this.translate.instant('Error');
          err = this.bwcErrorProvider.msg(err);
          this.popupProvider.ionicAlert(title, err);
        }
        return;
      });
  }

  private setBackupFlagIfNeeded(walletId: string) {
    if (this.createForm.value.selectedSeed == 'set') {
      this.profileProvider.setBackupFlag(walletId);
    } else if (this.createForm.value.addToVault) {
      const vault = this.profileProvider.getVault();
      if (!vault.needsBackup) this.profileProvider.setBackupFlag(walletId);
    }
  }

  private async setFingerprintIfNeeded(walletId: string) {
    if (!this.createForm.value.addToVault) return;
    const vaultWallets = this.profileProvider.getVaultWallets();
    const config = this.configProvider.get();
    const touchIdEnabled = config.touchIdFor
      ? config.touchIdFor[vaultWallets[0].credentials.walletId]
      : null;

    if (!touchIdEnabled) return;

    const opts = {
      touchIdFor: {}
    };
    opts.touchIdFor[walletId] = true;
    this.configProvider.set(opts);
  }

  public openSupportSingleAddress(): void {
    const url =
      'https://support.bitpay.com/hc/en-us/articles/360015920572-Setting-up-the-Single-Address-Feature-for-your-BitPay-Wallet';
    const optIn = true;
    const title = null;
    const message = this.translate.instant('Read more in our support page');
    const okText = this.translate.instant('Open');
    const cancelText = this.translate.instant('Go Back');
    this.externalLinkProvider.open(
      url,
      optIn,
      title,
      message,
      okText,
      cancelText
    );
  }
}
