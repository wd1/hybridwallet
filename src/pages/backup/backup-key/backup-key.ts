import { Component } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { NavController, NavParams } from 'ionic-angular';
import * as _ from 'lodash';

// pages
import { BackupGamePage } from '../backup-game/backup-game';

// providers
import { ActionSheetProvider } from '../../../providers/action-sheet/action-sheet';
import { BwcErrorProvider } from '../../../providers/bwc-error/bwc-error';
import { Logger } from '../../../providers/logger/logger';
import { ProfileProvider } from '../../../providers/profile/profile';
import { WalletProvider } from '../../../providers/wallet/wallet';

@Component({
  selector: 'page-backup-key',
  templateUrl: 'backup-key.html'
})
export class BackupKeyPage {
  public deleted: boolean;
  public mnemonicWords: string[];
  public wordToShow: number;
  public credentialsEncrypted: boolean;
  public wallet;
  public keys;

  private walletId: string;

  constructor(
    private navCtrl: NavController,
    private navParams: NavParams,
    private logger: Logger,
    private profileProvider: ProfileProvider,
    private walletProvider: WalletProvider,
    private bwcErrorProvider: BwcErrorProvider,
    private translate: TranslateService,
    private actionSheetProvider: ActionSheetProvider
  ) {
    this.walletId = this.navParams.data.walletId;
    this.wallet = this.profileProvider.getWallet(this.walletId);
    this.credentialsEncrypted = this.wallet.isPrivKeyEncrypted();
  }

  ionViewDidEnter() {
    this.deleted = this.isDeletedSeed();
    if (this.deleted) {
      this.logger.warn('no mnemonics');
      return;
    }

    this.walletProvider
      .getKeys(this.wallet)
      .then(keys => {
        if (_.isEmpty(keys)) {
          this.logger.warn('Empty keys');
        }
        this.showSafeguardMessage();
        this.credentialsEncrypted = false;
        this.keys = keys;
        this.setFlow();
      })
      .catch(err => {
        if (
          err &&
          err.message != 'FINGERPRINT_CANCELLED' &&
          err.message != 'PASSWORD_CANCELLED'
        ) {
          const title = this.translate.instant('Could not decrypt wallet');
          this.showErrorInfoSheet(this.bwcErrorProvider.msg(err), title);
        }
        this.navCtrl.pop();
      });
  }

  private showErrorInfoSheet(
    err: Error | string,
    infoSheetTitle: string
  ): void {
    if (!err) return;
    this.logger.warn('Could not get keys:', err);
    const errorInfoSheet = this.actionSheetProvider.createInfoSheet(
      'default-error',
      { msg: err, title: infoSheetTitle }
    );
    errorInfoSheet.present();
  }

  private isDeletedSeed(): boolean {
    if (
      !this.wallet.credentials.mnemonic &&
      !this.wallet.credentials.mnemonicEncrypted
    )
      return true;

    return false;
  }

  public goToBackupGame(): void {
    this.navCtrl.push(BackupGamePage, {
      words: this.mnemonicWords,
      keys: this.keys,
      walletId: this.walletId
    });
  }

  private setFlow(): void {
    if (!this.keys) return;

    let words = this.keys.mnemonic;

    this.mnemonicWords = words.split(/[\u3000\s]+/);
    this.wordToShow = 0;
  }

  public showSafeguardMessage(): void {
    const infoSheet = this.actionSheetProvider.createInfoSheet(
      'backup-safeguard-warning'
    );
    infoSheet.present();
  }

  public showDoThisLaterMessage(): void {
    const infoSheet = this.actionSheetProvider.createInfoSheet(
      'backup-later-warning'
    );
    infoSheet.present();
    infoSheet.onDidDismiss(option => {
      if (option) {
        this.navCtrl.pop();
      }
    });
  }

  public nextWord() {
    this.wordToShow++;
  }

  public previousWord() {
    this.wordToShow--;
  }
}
