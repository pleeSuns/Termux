import { Injectable } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material';
import { ConfirmDialogComponent } from 'app/pages/editor/components/dialogs/confirmdialog.component';
import { DemoDialogComponent } from 'app/pages/editor/components/dialogs/demodialog.component';
import {
  DropFilesAction,
  DropFilesDialogComponent,
} from 'app/pages/editor/components/dialogs/dropfilesdialog.component';
import { DemoInfo } from 'app/pages/editor/scripts/demos';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DialogService {
  constructor(private readonly dialog: MatDialog) {}

  confirm(title: string, message: string): Observable<boolean> {
    const config = new MatDialogConfig();
    config.data = { title, message };
    return this.dialog.open(ConfirmDialogComponent, config).afterClosed();
  }

  pickDemo(): Observable<DemoInfo> {
    return this.dialog.open(DemoDialogComponent, new MatDialogConfig()).afterClosed();
  }

  dropFiles(): Observable<DropFilesAction> {
    return this.dialog.open(DropFilesDialogComponent, new MatDialogConfig()).afterClosed();
  }
}
